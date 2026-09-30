function registerContextMenu() {
  // onInstalled fires again on every "reload" in chrome://extensions during
  // development (reason "update"), not just the first install. Creating with
  // a fixed id a second time throws "Cannot create item with id playMath
  // already exists" (surfaced only as chrome.runtime.lastError, since
  // create() takes a callback, not a promise) and leaves no menu item at
  // all. removeAll() first makes this idempotent regardless of prior state.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "playMath",
      title: "Build Seminar from Selection",
      contexts: ["selection"]
    });
  });
}

// Per-tab side panels, the hard way — two things are both required, and
// each one alone silently fails to isolate tabs:
//
// 1. manifest.json declares NO side_panel.default_path. Declaring one (even
//    though chrome.sidePanel.setOptions({tabId,...}) is also called for
//    every tab below) creates a persistent global panel instance that
//    otherwise keeps winning — a tab-specific registration doesn't fully
//    displace it, so every tab kept showing whatever seminar was generated
//    first, no matter how many tabs were individually registered.
// 2. Every call site that shows the panel must call setOptions({tabId,...})
//    BEFORE open({tabId,...}), not after. Calling open() first (this
//    project shipped that ordering twice, once via {windowId} and once via
//    {tabId} before setOptions had run) makes Chrome resolve to a global
//    panel even when a tab-specific one is registered moments later.
//    setOptions() must NOT be awaited before the open() call, though —
//    awaiting it breaks the user-gesture window open() requires. Calling it
//    synchronously without awaiting, immediately followed by open() in the
//    same synchronous block, satisfies both constraints at once.
function registerPanelForTab(tabId) {
  if (tabId === undefined) return;
  chrome.sidePanel.setOptions({ tabId, path: `sidepanel.html?tabId=${tabId}`, enabled: true });
}

async function registerPanelForAllTabs() {
  const tabs = await chrome.tabs.query({});
  tabs.forEach((t) => registerPanelForTab(t.id));
}

function initSidePanel() {
  // No tabId = the global/default panel. Explicitly disabling it (on top of
  // never declaring side_panel.default_path in the manifest) makes sure
  // nothing can fall back to a shared instance — every tab must get its own
  // explicit registration below before it has any panel at all.
  chrome.sidePanel.setOptions({ enabled: false });
  registerPanelForAllTabs();
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  initSidePanel();
});

// MV3 service workers are ephemeral and can be evicted and restarted
// without onInstalled firing again — re-register on every startup too so a
// woken-up worker can't end up with no menu item (or no per-tab panels)
// registered.
chrome.runtime.onStartup.addListener(() => {
  registerContextMenu();
  initSidePanel();
});

// Tabs opened after install/startup need their own panel registration too,
// so every tab — not just ones that have been right-clicked — gets an
// isolated panel from the start (covers the toolbar-icon-click path, not
// just the context-menu path).
chrome.tabs.onCreated.addListener((tab) => registerPanelForTab(tab.id));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "playMath" && tab?.id !== undefined) {
    // Order matters (see the block comment above registerPanelForTab):
    // register this tab's panel path first, THEN open it — both scoped to
    // tabId, and open() called synchronously right after, not awaited, so
    // the user-gesture window is still intact.
    registerPanelForTab(tab.id);
    chrome.sidePanel.open({ tabId: tab.id });

    // Capture the visible tab to send to Gemini for OCR math reconstruction
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 }, (dataUrl) => {
        const payload = {
            action: "playMath",
            text: info.selectionText,
            screenshotDataUrl: dataUrl,
            targetTabId: tab.id
        };

        // Scoped to this tab: with per-tab panels, more than one tab's panel
        // page can be alive at once, so a global key/broadcast could leak
        // this selection into the wrong tab's panel.
        chrome.storage.session.set({ [`pendingMathSelection_${tab.id}`]: payload }, () => {
          // Also try sending a message directly in case it's already open;
          // ui/main.js filters this by targetTabId itself.
          chrome.runtime.sendMessage(payload).catch(() => {
             // Ignore error: side panel wasn't open yet, it will read from session storage when it loads
          });
        });
    });
  }
});

// Session storage clears itself at browser-session end regardless, but drop
// a closed tab's stashed selection promptly rather than leaving it around.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`pendingMathSelection_${tabId}`);
});
