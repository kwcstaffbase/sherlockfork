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
      if (document.querySelector(id)) {
        mo.disconnect();
        callback(document.querySelector(id));
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
  .page-content {
      opacity: 0;
      transition: opacity 0.4s ease-in-out;
  }

  .page-content.sherlock-ready {
      opacity: 1 !important;
  }

  #side-menu {
      margin-top: 0.6rem;
      width: 250px;
      padding: 1rem;
      border-radius: 6px;
      border: 1px solid #e2e2e4;
      background-color: #ffffff;
  }

  #side-menu li.active a { font-weight: bold; color: #0078d4; }

  /* Ensure the container behaves like a flexbox when the menu is present */
  .page-content:has(#side-menu) {
      display: flex;
      gap: 2rem;
      align-items: flex-start;
  }
`;
document.head.appendChild(style);

var sherlock = new Sherlock();

sherlock
  .on("*")
  .find("html:has(.page-content)")
  .do(async (e) => {
    const pageContent = document.querySelector(".page-content");
    if (!pageContent) return;

    // --- REVEAL PROTECTION ---
    // Safety: If logic hangs, show the page after 2 seconds regardless.
    let hasRevealed = false;
    const revealPage = () => {
      if (hasRevealed) return;
      hasRevealed = true;
      pageContent.classList.add("sherlock-ready");
    };
    const safetyTimer = setTimeout(revealPage, 2000);

    // Only attempt menu logic on specific page types
    const pageType = document.documentElement.getAttribute("data-current-page-type");
    const validMenuPages = ["staticPage", "menuPage", "feed"];

    if (!validMenuPages.includes(pageType)) {
      revealPage();
      return;
    }

    // Wait for breadcrumbs to build the menu
    Sherlock.doWhenElementAppears(".breadcrumbs-list", async () => {
      try {
        let sideMenuContainer = document.getElementById("side-menu");
        let menuData = null;

        let crumbtrailIds = getCrumbtrailIds();
        const currentMenuId = document.documentElement.getAttribute("data-menu-id");
        if (currentMenuId) crumbtrailIds.unshift(currentMenuId);

        for (let id of crumbtrailIds) {
          const response = await fetch(`/api/menu/${id}`);
          if (response.ok) {
            const data = await response.json();
            if (data?.children?.data?.length > 0) {
              menuData = data;
              break;
            }
          }
        }

        if (menuData) {
          if (!sideMenuContainer) {
            sideMenuContainer = document.createElement("div");
            sideMenuContainer.id = "side-menu";
            pageContent.insertBefore(sideMenuContainer, pageContent.firstChild);
          }

          let sideMenu = document.createElement("ul");
          menuData.children.data.forEach(item => {
            let li = document.createElement("li");
            if (item.id === menuData.id) li.classList.add("active");
            let link = document.createElement("a");
            link.setAttribute("href", item.target.url);
            link.textContent = item.config.localization.en_US.title;
            li.appendChild(link);
            sideMenu.appendChild(li);
          });

          let heading = document.createElement("h3");
          heading.textContent = menuData.config.localization.en_US.title || "Menu";
          sideMenuContainer.replaceChildren(heading, sideMenu);
        }
      } catch (err) {
        console.error("Side Menu Error:", err);
      } finally {
        clearTimeout(safetyTimer);
        revealPage();
      }
    });
  });

sherlock.observe();

function getCrumbtrailIds() {
  return Array.from(document.querySelectorAll(".breadcrumbs-list-item:has(a)"))
    .reverse()
    .map(item => {
      const href = item.querySelector("a").getAttribute("href").split("?", 1)[0];
      return href.split("/").find(s => /^[0-9a-f]{24}$/i.test(s)) || null;
    }).filter(id => id !== null);
}
