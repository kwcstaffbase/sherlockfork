class Sherlock {
  static eventName = "sherlock:navigated";

  // These a copied into each Sherlock instance
  static macros = new Map();

  workers = new Map();
  lastLocation;

  // We track all mutation observers to disconnect them later
  // These are added when a navigation event occurs, and should only live until the next navigation
  // They are disconnected and cleared on each navigation
  // Additionally, they are one-time observers that disconnect themselves when they find the target element
  // Thus, many of these observers will not actively be observing at any given time
  static mutationObservers = [];
  static clearObservers = () => {
    Sherlock.mutationObservers.forEach((mo) => {
      mo.disconnect();
    });
    Sherlock.mutationObservers = [];
  };

  constructor() {
    for (let macroName of Sherlock.macros.keys()) {
      this[macroName] = Sherlock.macros.get(macroName);
    }
  }

  observe() {
    // This fires on every page navigation
    document.addEventListener(Sherlock.eventName, (event) => {
      Sherlock.clearObservers();

      if (event.detail?.type == null) return;

      let allWorkers = [
        ...(this.workers.get("*") ?? []),
        ...(this.workers.get(event.detail.type) ?? []),
      ];
      allWorkers.forEach((worker) => {
        worker.execute();
      });
    });

    // Hook up the mutation observer to detect navigation changes

    let currentPageContent = null;
    let debounceTimer = null;
    const pageContentObserver = new MutationObserver((mutations) => {
      // Clear existing timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Set new timer to execute after 100ms of inactivity
      debounceTimer = setTimeout(() => {
        const el = document.querySelector(".page-content");

        if (el && el !== currentPageContent) {
          currentPageContent = el;
          console.log("Page content appeared");
        } else if (!el && currentPageContent) {
          currentPageContent = null;
          return;
        }

        for (var m of mutations) {
          //if (m.type === "attributes") {
          var htmlNode = document.querySelector("html");
          var pageType = htmlNode.getAttribute("data-current-page-type");

          // The code below extracts a unique identifier for the current page based on its type
          // This is necessary because there is no consistent ID in the HTML tag
          // In some cases, we have to wait for specific elements to appear in the DOM

          if (pageType === "profile") {
            Sherlock.doWhenElementAppears("user-profile-widget", (el) => {
              this.evalForNavigation(
                "profile",
                document
                  .querySelector("user-profile-widget")
                  ?.getAttribute("user-id")
              );
            });
          }

          if (pageType === "staticPage" || pageType === "feed") {
            Sherlock.doWhenElementAppears("html[data-menu-id]", (el) => {
              this.evalForNavigation(
                "staticPage",
                htmlNode?.getAttribute("data-menu-id")
              );
            });
          }

          if (pageType === "news") {
            this.evalForNavigation(
              "news",
              htmlNode?.getAttribute("data-post-id")
            );
          }

          if (pageType === "archive") {
            this.evalForNavigation(
              "archive",
              htmlNode?.getAttribute("data-installation-id")
            );
          }

          if (pageType === "menuPage") {
            Sherlock.doWhenElementAppears(".breadcrumbs-list-item a", (el) => {
              this.evalForNavigation("menuPage", el.getAttribute("href"));
            });
          }
          //}
        }
      }, 100); // End of debounce setTimeout
    });

    pageContentObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // observer.observe(target, {
    //   attributes: true,
    //   attributeFilter: [
    //     "data-current-page-type",
    //     "data-menu-id",
    //     "data-post-id",
    //     "data-installation-id",
    //   ],
    // });
  }

  evalForNavigation(pageType, pageId) {
    if (
      pageType != null &&
      pageId != null &&
      pageType + pageId !== this.lastLocation
    ) {
      console.log(`Detected navigation to: ${pageType}://${pageId}`);
      document.dispatchEvent(
        new CustomEvent(Sherlock.eventName, {
          detail: { type: pageType, id: pageId },
        })
      );
      this.lastLocation = pageType + pageId;
    }
  }

  onProfile() {
    return this.on("profile");
  }

  onNews() {
    return this.on("news");
  }

  onPage() {
    return this.on("staticPage");
  }

  onMenu() {
    return this.on("menu");
  }

  onAll() {
    return this.on("*");
  }

  on(type) {
    if (!this.workers.has(type)) {
      this.workers.set(type, []);
    }

    let worker = new SherlockWorker();
    this.workers.get(type).push(worker);

    return worker;
  }

  static doWhenElementAppears(id, callback) {
    // If the element already exists, call the callback immediately
    let el = document.querySelector(id);
    if (el) {
      callback(el);
      return;
    }

    let mo = new MutationObserver((mutations) => {
      outerLoop: for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!document.querySelector) continue; // If it's not a queryable node...
          if (document.querySelector(id)) {
            mo.disconnect();
            callback(document.querySelector(id));
            break outerLoop; // We only run one time, so exit all loops
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // We track all mutation observers to disconnect and delete them later
    // Otherwise, if an element never appears, the observer will remain active indefinitely
    // We effectively give up after a navigation event
    Sherlock.mutationObservers.push(mo);
  }
}

class SherlockWorker {
  actions = [];
  selector;

  find(selector) {
    this.selector = selector;
    return this;
  }

  appendHtml(html, where = "beforeend") {
    this.do((el) => {
      el.insertAdjacentHTML(where, html);
    });
    return this;
  }

  appendChild(child) {
    this.do((el) => {
      el.appendChild(child);
    });
    return this;
  }

  replaceHtml(html) {
    this.do((el) => {
      el.innerHTML = html;
    });
    return this;
  }

  appendTag(tagName, attributes = {}) {
    this.do((el) => {
      let tag = document.createElement(tagName);
      for (let attr in attributes) {
        tag.setAttribute(attr, attributes[attr]);
      }
      el.appendChild(tag);
    });
    return this;
  }

  do(action) {
    this.actions.push(action);
    return this;
  }

  execute() {
    Sherlock.doWhenElementAppears(this.selector, (el) => {
      for (const action of this.actions) {
        action(el);
      }
    });
  }
}

// Don't use arrow function here, we need 'this' to refer to the Sherlock class
Sherlock.macros.set("addUnderProfileSidebar", function (html) {
  this.onProfile()
    .find("#up-main-layout .business-card > div")
    .appendHtml(html);
});

var sherlock = new Sherlock();
// sherlock
//   .onPage()
//   .find(".breadcrumbs-list li:last-child")
//   .do((el) => {
//     document.querySelectorAll("li.added").forEach(el => el.remove() );
//   })
//   .appendHtml(
//     `<span class="added breadcrumb-separator css-637cq3-BreadcrumbItem-breadcrumbStyle-SeparatorItem e1eqfy4p0" aria-hidden="true"><svg width="6" height="8" viewBox="0 0 6 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 0.444473L5 3.99996L1 7.55552" stroke="currentColor"></path></svg></span>`
//   );
// sherlock
//   .onPage()
//   .find(".breadcrumbs-list")
//   .appendHtml(
//     `<li class="added breadcrumbs-list-item css-9s61it-Item e9xk63n1"><span class="navigation breadcrumb-item current css-3fv1u4-BreadcrumbItem-breadcrumbStyle edbwz602" aria-current="page">Another Breadcrumb...</span></li>`
//   );

// // This is using a defined "macro"
// sherlock.addUnderProfileSidebar(
//   `<img src="https://live.deanebarker.net/assets/sb/gold-trophy.jpg" style="width:132px; height:132px; margin-left:8px;" title="Top Performer"/>`
// );

// sherlock.onAll().find("#up-profile-name").appendHtml("!");
// sherlock.observe();

let style = document.createElement("style");
style.textContent = `
#side-menu {
margin-top: 0.6rem;
width: 20%;
padding: 1rem;
border-radius: 6px;
border: 1px solid #e2e2e4;
box-shadow: 0 2px 4px 0 rgba(30, 31, 31, 0.1);
background-color: #ffffff;
}

#side-menu li {
margin-bottom: 0.5rem;
margin-top: 0.5rem;
padding: 0.5rem 0rem;
}

*:has(>#side-menu) {
display: flex;
gap: 2rem;
align-items: flex-start;
}

// li.active {
// background-color: #f0f0f2;
// border-left: 4px solid #0078d4;
// padding-left: 0.5rem;
// font-weight: bold;}

`;

document.head.appendChild(style);

sherlock
  .on("*")
  .find("html:has(.breadcrumbs-list):has(.page-content)")
  .do(async (e) => {
    Sherlock.doWhenElementAppears(".breadcrumbs-list", async (container) => {
      console.log("Side Menu Eval");

      let sideMenuContainer = document.getElementById("side-menu");

      let menuData = undefined;

      // Get all the IDs in the crumbtrail
      let crumbtrailIds = getCrumbtrailIds();
      if (e.dataset.menuId) {
        crumbtrailIds.unshift(e.dataset.menuId); // Check the current page too
      }

      // Try each ID until we find one with menu data
      for (let id of crumbtrailIds) {
        try {
          let response = await fetch("/api/menu/" + id);
          if (response.ok) {
            data = await response.json();
            if (
              data &&
              data.children &&
              data.children.data &&
              data.children.data.length > 0
            ) {
              menuData = data;
              console.log("Found menu for", id);
              break;
            }
          }
        } catch (err) {
          console.error("No menu found for", id);
        }
      }

      // None of our targets had menu data
      if (!menuData) {
        console.log(
          "No menu data found for crumbtrail IDs" + crumbtrailIds.join(", ")
        );
        sideMenuContainer?.remove();
        return;
      }

      // I don't think this matters, because I think it gets wiped out after I check this

      // Side menu exists and is already current
      if (menuData.id === sideMenuContainer?.dataset.currentMenuId) {
        console.log("Side menu is already current for menu ID" + menuData.id);
        return;
      }

      if (!sideMenuContainer) {
        sideMenuContainer = document.createElement("div");
        sideMenuContainer.id = "side-menu";
        // Set the menu ID to avoid re-creating it unnecessarily
        sideMenuContainer.dataset.currentMenuId = menuData.id;

        // Make sure we don't get two of them
        document.getElementById("side-menu")?.remove();

        let container = document.querySelector(".page-content");
        container.insertBefore(sideMenuContainer, container.firstChild);
      }

      console.log("Building side menu for menu ID", menuData.id, menuData);
      console.log("Menu items", menuData.children.data);

      let sideMenu = document.createElement("ul");
      for (let thisMenuItem of menuData.children.data) {
        let thisListItem = document.createElement("li");

        if (thisMenuItem.id === menuData.id) {
          thisListItem.classList.add("active");
        }

        let link = document.createElement("a");
        link.setAttribute("href", thisMenuItem.target.url);
        link.textContent = thisMenuItem.config.localization.en_US.title;
        thisListItem.appendChild(link);
        sideMenu.appendChild(thisListItem);
      }

      console.log("Side menu built", sideMenu);

      let heading = document.createElement("h3");
      heading.textContent = menuData.config.localization.en_US.title || "Menu";

      console.log("Placing side menu", sideMenuContainer);

      sideMenuContainer.replaceChildren(heading);
      sideMenuContainer.appendChild(sideMenu);

      console.log("Side menu placed", document.querySelector("#side-menu"));
    });
  });

sherlock.observe();

function getCrumbtrailIds() {
  let crumbtrailItemsWithLinks = Array.from(
    document.querySelectorAll(".breadcrumbs-list-item:has(a)")
  );
  crumbtrailItemsWithLinks.reverse();
  return crumbtrailItemsWithLinks.map((item) => {
    let link = item.querySelector("a").getAttribute("href");
    link = link.split("?", 1)[0];
    let id = getHex24Segment(link);
    return id;
  });
}

function getLastCrumbtrailTitle() {
  let lastCrumbtrailItem = Array.from(
    document.querySelectorAll(".breadcrumbs-list-item:has(a)")
  ).at(-1);
  return lastCrumbtrailItem.querySelector("a").textContent;
}

function extractParts(str) {
  // (1) Everything before the first "?"
  const beforeQuery = str.split("?", 1)[0];

  // (2) Everything after the last "/"
  const afterLastSlash = beforeQuery.substring(
    beforeQuery.lastIndexOf("/") + 1
  );

  return afterLastSlash;
}

function getHex24Segment(path) {
  return (
    path.split("/").find((segment) => /^[0-9a-f]{24}$/i.test(segment)) || null
  );
}