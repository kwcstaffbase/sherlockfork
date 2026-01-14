class Sherlock {
  static eventName = "sherlock:navigated";
  static macros = new Map();

  workers = new Map();
  lastLocation;

  static mutationObservers = [];
  static clearObservers = () => {
    Sherlock.mutationObservers.forEach((mo) => mo.disconnect());
    Sherlock.mutationObservers = [];
  };

  constructor() {
    for (let macroName of Sherlock.macros.keys()) {
      this[macroName] = Sherlock.macros.get(macroName);
    }
  }

  observe() {
    document.addEventListener(Sherlock.eventName, (event) => {
      Sherlock.clearObservers();
      if (event.detail?.type == null) return;

      let allWorkers = [
        ...(this.workers.get("*") ?? []),
        ...(this.workers.get(event.detail.type) ?? []),
      ];
      allWorkers.forEach((worker) => worker.execute());
    });

    let currentPageContent = null;
    let debounceTimer = null;
    const pageContentObserver = new MutationObserver((mutations) => {
      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(() => {
        const el = document.querySelector(".page-content");

        if (el && el !== currentPageContent) {
          currentPageContent = el;
        } else if (!el && currentPageContent) {
          currentPageContent = null;
          return;
        }

        for (var m of mutations) {
          var htmlNode = document.querySelector("html");
          var pageType = htmlNode.getAttribute("data-current-page-type");

          if (pageType === "profile") {
            Sherlock.doWhenElementAppears("user-profile-widget", (el) => {
              this.evalForNavigation("profile", el.getAttribute("user-id"));
            });
          }

          if (pageType === "staticPage" || pageType === "feed") {
            Sherlock.doWhenElementAppears("html[data-menu-id]", (el) => {
              this.evalForNavigation("staticPage", htmlNode?.getAttribute("data-menu-id"));
            });
          }

          if (pageType === "news") {
            this.evalForNavigation("news", htmlNode?.getAttribute("data-post-id"));
          }

          if (pageType === "archive") {
            this.evalForNavigation("archive", htmlNode?.getAttribute("data-installation-id"));
          }

          if (pageType === "menuPage") {
            Sherlock.doWhenElementAppears(".breadcrumbs-list-item a", (el) => {
              this.evalForNavigation("menuPage", el.getAttribute("href"));
            });
          }
        }
      }, 100);
    });

    pageContentObserver.observe(document.body, { childList: true, subtree: true });
  }

  evalForNavigation(pageType, pageId) {
    if (pageType != null && pageId != null && pageType + pageId !== this.lastLocation) {
      console.log(`Detected navigation to: ${pageType}://${pageId}`);
      document.dispatchEvent(new CustomEvent(Sherlock.eventName, { detail: { type: pageType, id: pageId } }));
      this.lastLocation = pageType + pageId;
    }
  }

  onProfile() { return this.on("profile"); }
  onNews() { return this.on("news"); }
  onPage() { return this.on("staticPage"); }
  onMenu() { return this.on("menu"); }
  onAll() { return this.on("*"); }

  on(type) {
    if (!this.workers.has(type)) this.workers.set(type, []);
    let worker = new SherlockWorker();
    this.workers.get(type).push(worker);
    return worker;
  }

  static doWhenElementAppears(id, callback) {
    let el = document.querySelector(id);
    if (el) { callback(el); return; }

    let mo = new MutationObserver((mutations) => {
      outerLoop: for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (document.querySelector(id)) {
            mo.disconnect();
            callback(document.querySelector(id));
            break outerLoop;
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    Sherlock.mutationObservers.push(mo);
  }
}

class SherlockWorker {
  actions = [];
  selector;
  find(selector) { this.selector = selector; return this; }
  appendHtml(html, where = "beforeend") { this.do((el) => el.insertAdjacentHTML(where, html)); return this; }
  do(action) { this.actions.push(action); return this; }
  execute() { Sherlock.doWhenElementAppears(this.selector, (el) => { for (const action of this.actions) action(el); }); }
}

// Global Styles
let style = document.createElement("style");
style.textContent = `
/* Hide page content initially to prevent flicker */
.page-content {
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
}

/* Class to reveal content once Sherlock is finished */
.page-content.sherlock-ready {
    opacity: 1 !important;
}

#side-menu {
    margin-top: 0.6rem;
    width: 20%;
    padding: 1rem;
    border-radius: 6px;
    border: 1px solid #e2e2e4;
    box-shadow: 0 2px 4px 0 rgba(30, 31, 31, 0.1);
    background-color: #ffffff;
}

#side-menu li { margin-bottom: 0.5rem; margin-top: 0.5rem; padding: 0.5rem 0rem; }
#side-menu li.active { font-weight: bold; color: #0078d4; }

*:has(>#side-menu) {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
}
`;
document.head.appendChild(style);

var sherlock = new Sherlock();

// SIDE MENU LOGIC WITH REVEAL PROTECTION
sherlock
  .on("*")
  .find("html:has(.breadcrumbs-list):has(.page-content)")
  .do(async (e) => {
    const pageContent = document.querySelector(".page-content");
    // Force hidden if CSS hasn't caught it yet
    if (pageContent) pageContent.style.opacity = "0";

    Sherlock.doWhenElementAppears(".breadcrumbs-list", async (container) => {
      let sideMenuContainer = document.getElementById("side-menu");
      let menuData = undefined;

      try {
        let crumbtrailIds = getCrumbtrailIds();
        if (e.dataset.menuId) crumbtrailIds.unshift(e.dataset.menuId);

        for (let id of crumbtrailIds) {
          try {
            let response = await fetch("/api/menu/" + id);
            if (response.ok) {
              let data = await response.json();
              if (data?.children?.data?.length > 0) {
                menuData = data;
                break;
              }
            }
          } catch (err) { console.error("Fetch failed for", id); }
        }

        if (menuData) {
          if (!sideMenuContainer) {
            sideMenuContainer = document.createElement("div");
            sideMenuContainer.id = "side-menu";
            sideMenuContainer.dataset.currentMenuId = menuData.id;
            pageContent.insertBefore(sideMenuContainer, pageContent.firstChild);
          }

          let sideMenu = document.createElement("ul");
          for (let item of menuData.children.data) {
            let li = document.createElement("li");
            if (item.id === menuData.id) li.classList.add("active");
            let link = document.createElement("a");
            link.setAttribute("href", item.target.url);
            link.textContent = item.config.localization.en_US.title;
            li.appendChild(link);
            sideMenu.appendChild(li);
          }

          let heading = document.createElement("h3");
          heading.textContent = menuData.config.localization.en_US.title || "Menu";
          sideMenuContainer.replaceChildren(heading, sideMenu);
        } else {
          sideMenuContainer?.remove();
        }

      } catch (err) {
        console.error("Sherlock Error:", err);
      } finally {
        // REVEAL CONTENT: Ensure the page shows even if logic fails
        if (pageContent) {
          pageContent.classList.add("sherlock-ready");
        }
      }
    });
  });

sherlock.observe();

// Helper Functions
function getCrumbtrailIds() {
  return Array.from(document.querySelectorAll(".breadcrumbs-list-item:has(a)"))
    .reverse()
    .map((item) => getHex24Segment(item.querySelector("a").getAttribute("href").split("?", 1)[0]));
}

function getHex24Segment(path) {
  return path.split("/").find((segment) => /^[0-9a-f]{24}$/i.test(segment)) || null;
}
