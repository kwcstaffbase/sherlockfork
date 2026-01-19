/**
 * Staffbase News Widget using Sherlock Observer Pattern
 * * Purpose: Statically displays the latest news from a specific channel upon page load.
 * Reference: Adapted from provided Sherlock/deane2.js architecture.
 */

// --- CONFIGURATION ---
const CONFIG = {
    // The Channel ID provided in the requirements
    channelId: "62dae31dae96d800cb1eaac1",
    
    // API Configuration
    // NOTE: Use relative path '/api' if running internally, or full URL if external.
    apiBaseUrl: "/api", 
    limit: 3, // Number of posts to show
    
    // SECURITY WARNING: 
    // This token is visible to users. Ensure it has RESTRICTED READ-ONLY permissions 
    // specifically for the channel above. Do not use an Administrative token.
    apiToken: "NjJkYWUzMWIzZmFmMjUyZjgyYWNjMjM1OlIwSysuaEhTOUZYT3FxQ2p4KFpzWFYzWWgmfkt1ZVpzIVtkQjVJcm9+VV43dWkkSDhBUUV+XlE7cDlNenVpRmI=",

    // DOM Injection Settings
    containerId: "custom-static-news-widget",
    targetSelector: ".page-content", // Where to inject the widget
    injectMethod: "prepend" // 'prepend' (top) or 'append' (bottom)
};

// --- SHERLOCK OBSERVATION ENGINE ---
// (Adapted from reference code to handle SPA navigation)
class Sherlock {
    static eventName = "sherlock:navigated";
    workers = new Map();
    lastLocation;
    static mutationObservers = [];

    static clearObservers = () => {
        Sherlock.mutationObservers.forEach((mo) => mo.disconnect());
        Sherlock.mutationObservers = [];
    };

    observe() {
        // Listen for the custom navigation event
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

        // Observe DOM for page transitions
        const pageContentObserver = new MutationObserver((mutations) => {
            if (debounceTimer) clearTimeout(debounceTimer);

            debounceTimer = setTimeout(() => {
                const el = document.querySelector(".page-content");

                // Detect if page content container has been refreshed
                if (el && el !== currentPageContent) {
                    currentPageContent = el;
                } else if (!el && currentPageContent) {
                    currentPageContent = null;
                    return;
                }

                // Determine current page context
                const htmlNode = document.querySelector("html");
                const pageType = htmlNode.getAttribute("data-current-page-type") || "unknown";
                
                // Use a combination of ID and Type to detect navigation
                const pageId = htmlNode.getAttribute("data-post-id") || 
                               htmlNode.getAttribute("data-menu-id") || 
                               window.location.pathname; // Fallback to URL

                this.evalForNavigation(pageType, pageId);
            }, 100); // 100ms debounce
        });

        pageContentObserver.observe(document.body, { childList: true, subtree: true });
    }

    evalForNavigation(pageType, pageId) {
        // Only trigger if we have actually changed location/context
        const locationKey = pageType + ":" + pageId;
        if (pageType != null && pageId != null && locationKey !== this.lastLocation) {
            console.log(`[Sherlock] Navigated to: ${locationKey}`);
            document.dispatchEvent(new CustomEvent(Sherlock.eventName, { 
                detail: { type: pageType, id: pageId } 
            }));
            this.lastLocation = locationKey;
        }
    }

    on(type) {
        if (!this.workers.has(type)) this.workers.set(type, []);
        let worker = new SherlockWorker();
        this.workers.get(type).push(worker);
        return worker;
    }

    onAll() { return this.on("*"); }

    static doWhenElementAppears(selector, callback) {
        let el = document.querySelector(selector);
        if (el) { callback(el); return; }

        let mo = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                mo.disconnect();
                callback(found);
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
    do(action) { this.actions.push(action); return this; }
    execute() { 
        Sherlock.doWhenElementAppears(this.selector, (el) => { 
            for (const action of this.actions) action(el); 
        }); 
    }
}

// --- NEWS SERVICE (API LAYER) ---
const NewsService = {
    async fetchLatestNews() {
        const endpoint = `${CONFIG.apiBaseUrl}/channels/${CONFIG.channelId}/posts?limit=${CONFIG.limit}`;
        
        try {
            const response = await fetch(endpoint, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Basic ${CONFIG.apiToken}`
                }
            });

            if (!response.ok) {
                console.error(`[News Widget] API Error: ${response.status}`);
                return [];
            }

            const json = await response.json();
            return json.data || [];
        } catch (error) {
            console.error("[News Widget] Network Error:", error);
            return [];
        }
    },

    // Normalize API data into a simple object for the view
    normalize(post) {
        // Handle Localization (Fallback to en_US or first available)
        const content = post.contents ? (post.contents['en_US'] || Object.values(post.contents)[0]) : {};
        
        // Handle Images (Prefer thumb, fall back to original)
        let imageUrl = null;
        if (post.image) {
            imageUrl = post.image.thumb?.url || post.image.original?.url;
        }

        return {
            id: post.id,
            title: content.title || "Untitled Post",
            teaser: content.teaser || "",
            date: new Date(post.published).toLocaleDateString(),
            image: imageUrl,
            link: `/content/news/article/${post.id}` // Internal deep link format
        };
    }
};

// --- RENDERER (UI LAYER) ---
const NewsRenderer = {
    injectStyles() {
        const styleId = "sb-news-widget-css";
        if (document.getElementById(styleId)) return;

        const css = `
            #${CONFIG.containerId} {
                background: #fff;
                border: 1px solid #e2e2e4;
                border-radius: 6px;
                padding: 1rem;
                margin-bottom: 1.5rem;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            }
            #${CONFIG.containerId} h3 {
                font-size: 1.1rem;
                margin-top: 0;
                margin-bottom: 1rem;
                padding-bottom: 0.5rem;
                border-bottom: 2px solid #0078d4;
                display: inline-block;
            }
            .sb-news-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            .sb-news-item {
                display: flex;
                gap: 1rem;
                margin-bottom: 1rem;
                padding-bottom: 1rem;
                border-bottom: 1px solid #f0f0f0;
            }
            .sb-news-item:last-child {
                margin-bottom: 0;
                padding-bottom: 0;
                border-bottom: none;
            }
            .sb-news-thumb {
                width: 60px;
                height: 60px;
                object-fit: cover;
                border-radius: 4px;
                flex-shrink: 0;
                background-color: #f5f5f5;
            }
            .sb-news-content {
                display: flex;
                flex-direction: column;
                justify-content: center;
            }
            .sb-news-title {
                font-size: 0.95rem;
                font-weight: 600;
                margin: 0 0 0.25rem 0;
                line-height: 1.3;
            }
            .sb-news-title a {
                color: #333;
                text-decoration: none;
                transition: color 0.2s;
            }
            .sb-news-title a:hover {
                color: #0078d4;
            }
            .sb-news-meta {
                font-size: 0.8rem;
                color: #666;
            }
        `;
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    },

    buildHTML(posts) {
        if (!posts || posts.length === 0) return "";

        const listItems = posts.map(post => `
            <li class="sb-news-item">
                ${post.image ? `<img src="${post.image}" class="sb-news-thumb" alt="" />` : ''}
                <div class="sb-news-content">
                    <h4 class="sb-news-title">
                        <a href="${post.link}">${post.title}</a>
                    </h4>
                    <span class="sb-news-meta">${post.date}</span>
                </div>
            </li>
        `).join("");

        return `
            <div id="${CONFIG.containerId}">
                <h3>Latest Updates</h3>
                <ul class="sb-news-list">${listItems}</ul>
            </div>
        `;
    }
};

// --- INITIALIZATION ---

// 1. Initialize Sherlock
const sherlock = new Sherlock();

// 2. Define the Worker
sherlock
    .on("*") // Run on all pages (or change to 'staticPage', 'news' etc.)
    .find(CONFIG.targetSelector) // Wait for .page-content to exist
    .do(async (container) => {
        // Idempotency: Don't inject if it already exists in this container
        if (container.querySelector(`#${CONFIG.containerId}`)) return;

        console.log("[News Widget] Page loaded, initializing widget...");

        // Inject Styles
        NewsRenderer.injectStyles();

        // Prepare Container (Loading State)
        const widgetWrapper = document.createElement("div");
        widgetWrapper.id = CONFIG.containerId + "-wrapper";
        
        // Inject into DOM
        if (CONFIG.injectMethod === "prepend") {
            container.insertBefore(widgetWrapper, container.firstChild);
        } else {
            container.appendChild(widgetWrapper);
        }

        // Fetch Data
        const rawPosts = await NewsService.fetchLatestNews();

        if (rawPosts && rawPosts.length > 0) {
            const normalizedPosts = rawPosts.map(NewsService.normalize);
            widgetWrapper.outerHTML = NewsRenderer.buildHTML(normalizedPosts);
        } else {
            // Cleanup if no news or error
            widgetWrapper.remove();
        }
    });

// 3. Start Observing
sherlock.observe();