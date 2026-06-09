'use strict';
importScripts("./action-items-utils.js", "../packages/uuidv4.min.js");

const DEFAULT_QUICK_ACTIONS = [
  { id: "quick-action-1", label: "Gym", text: "Go to the gym", isLinkAction: false, icon: { type: "favicon", url: "https://www.google.com/s2/favicons?domain=google.com&sz=32" } },
  { id: "quick-action-2", label: "Link site for later", text: "Read this site", isLinkAction: true, icon: null },
  { id: "quick-action-3", label: "Meditation", text: "Meditate", isLinkAction: false, icon: { type: "favicon", url: "https://www.google.com/s2/favicons?domain=spotify.com&sz=32" } },
];

chrome.runtime.onInstalled.addListener(function (details) {
  chrome.storage.local.get(["actionItems", "quickActions", "lastOpenedDate"], (data) => {
    const nextStorage = {};
    if (details.reason == "install" || !Array.isArray(data.actionItems)) {
      nextStorage.actionItems = [];
    }
    if (details.reason == "install" || !Array.isArray(data.quickActions)) {
      nextStorage.quickActions = DEFAULT_QUICK_ACTIONS;
    }
    if (details.reason == "install" || !data.lastOpenedDate) {
      nextStorage.lastOpenedDate = "";
    }
    chrome.storage.local.set(nextStorage);
  });

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "linkSiteMenu",
      title: "Link site for later",
      contexts: ["all"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId == "linkSiteMenu") {
    const url = ActionItems.getTabUrl(tab);
    const favIcon = ActionItems.getValidatedFavIcon(tab, url);
    if (!url) {
      return;
    }
    ActionItems.addQuickActionItem(
      "quick-action-2",
      "Read this site",
      {
        ...tab,
        url: url,
        favIconUrl: favIcon,
      },
      () => {
        ActionItems.setProgress();
      }
    );
  }
});

const TIMER_ALARM = "pomodoroTimerAlarm";
const hasAlarmsApi = typeof chrome !== "undefined" && chrome.alarms;

const getTimerRemainingMs = (timerState) => {
  const endTime = Number(timerState.timerEndTime || 0);
  if (!endTime) return 0;
  return Math.max(0, endTime - Date.now());
};

const clearTimerState = () => {
  ActionItems.setTimerState({
    activeTimerTaskId: "",
    timerEndTime: 0,
    timerRunning: false,
    timerMode: "",
    timerRemainingMs: 0,
  });
  if (hasAlarmsApi) {
    chrome.alarms.clear(TIMER_ALARM);
  }
};

const handleTimerAlarm = (alarm) => {
  if (!alarm || alarm.name !== TIMER_ALARM) return;
  ActionItems.getTimerState((timerState) => {
    const endTime = Number(timerState.timerEndTime || 0);
    const activeTaskId = timerState.activeTimerTaskId;
    const running = timerState.timerRunning;
    if (!activeTaskId || !endTime) {
      clearTimerState();
      return;
    }
    if (!running) return;
    const now = Date.now();
    if (now >= endTime) {
      chrome.storage.local.get(["actionItems"], (data) => {
        const items = data.actionItems || [];
        const index = items.findIndex((item) => item.id === activeTaskId);
        if (index >= 0) {
          items[index] = {
            ...items[index],
            pomodoroCount: (items[index].pomodoroCount || 0) + 1,
          };
          chrome.storage.local.set({
            actionItems: items,
            focusBannerText: `Focus session complete for: ${items[index].text} ✓`,
            focusBannerExpiresAt: Date.now() + 4000,
          });
        }
        clearTimerState();
        if (chrome.action && chrome.action.setBadgeText) {
          chrome.action.setBadgeText({ text: "✓" });
        }
        ActionItems.setProgress();
      });
      return;
    }
    if (hasAlarmsApi) {
      chrome.alarms.create(TIMER_ALARM, { when: endTime });
    }
  });
};

if (hasAlarmsApi) {
  chrome.alarms.onAlarm.addListener(handleTimerAlarm);
}

chrome.runtime.onStartup.addListener(() => {
  ActionItems.getTimerState((timerState) => {
    if (!timerState.activeTimerTaskId) return;
    const remainingMs = getTimerRemainingMs(timerState);
    if (remainingMs <= 0 && timerState.timerRunning) {
      clearTimerState();
      return;
    }
    if (timerState.timerRunning && remainingMs > 0) {
      chrome.alarms.clear(TIMER_ALARM, () => {
        chrome.alarms.create(TIMER_ALARM, { when: Date.now() + remainingMs });
      });
      return;
    }
    if (!timerState.timerRunning && remainingMs <= 0) {
      clearTimerState();
    }
  });
});
