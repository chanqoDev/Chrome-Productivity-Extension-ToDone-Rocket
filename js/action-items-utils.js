class ActionItems {
  static storage = chrome.storage.local;

  static getCurrentItems(callback) {
    ActionItems.storage.get(["actionItems"], (data) => {
      let items = data.actionItems || [];
      callback(items);
    });
  }

  static getQuickActions(callback) {
    ActionItems.storage.get(["quickActions"], (data) => {
      callback(
        (data.quickActions || []).map((action) => ({
          ...action,
          icon:
            action.icon && action.icon.type === "favicon"
              ? action.icon
              : null,
        }))
      );
    });
  }

  static setQuickActions(quickActions, callback) {
    ActionItems.storage.set(
      {
        quickActions: quickActions,
      },
      callback
    );
  }

  static addQuickActionItem(id, text, tab, callback) {
    let website = null;
    if (tab) {
      const url = ActionItems.getTabUrl(tab);
      const favIcon = ActionItems.getValidatedFavIcon(tab, url);
      if (!url) {
        return;
      }
      website = {
        url: url,
        fav_icon: favIcon,
        title: tab.title,
      };
      if (website.title == "New Tab") {
        return;
      }
    }
    let actionItem = {
      id: uuidv4(),
      added: new Date().toString(),
      completed: null,
      text: text,
      website: website,
    };
    ActionItems.add(actionItem, () => {
      if (callback) {
        callback(actionItem, 250);
      }
    });
  }

  static add(actionItem, callback) {
    ActionItems.storage.get(["actionItems"], (data) => {
      let items = data.actionItems || [];
      const hydratedItem = {
        focusDuration: 25,
        pomodoroCount: 0,
        ...actionItem,
      };
      ActionItems.storage.set(
        {
          actionItems: [hydratedItem, ...items],
        },
        callback
      );
    });
  }

  static saveName(name, callback) {
    ActionItems.storage.set(
      {
        name: name,
      },
      callback
    );
  }

  static markUnmarkCompleted(itemId, completedStatus, callback) {
    ActionItems.storage.get(["actionItems"], (data) => {
      let items = data.actionItems || [];
      let foundItemIndex = items.findIndex((el) => el.id == itemId);
      if (foundItemIndex >= 0) {
        items[foundItemIndex].completed = completedStatus;
        ActionItems.storage.set(
          {
            actionItems: items,
          },
          callback
        );
      }
    });
  }

  static remove(itemId, callback) {
    ActionItems.storage.get(["actionItems"], (data) => {
      let items = data.actionItems || [];
      let foundItemIndex = items.findIndex((el) => el.id == itemId);
      if (foundItemIndex >= 0) {
        items.splice(foundItemIndex, 1);
        ActionItems.storage.set(
          {
            actionItems: items,
          },
          callback
        );
      }
    });
  }

  static updateItem(itemId, patch, callback) {
    ActionItems.storage.get(["actionItems"], (data) => {
      let items = data.actionItems || [];
      let foundItemIndex = items.findIndex((el) => el.id == itemId);
      if (foundItemIndex >= 0) {
        items[foundItemIndex] = {
          ...items[foundItemIndex],
          ...patch,
          focusDuration:
            patch.focusDuration !== undefined
              ? patch.focusDuration
              : items[foundItemIndex].focusDuration || 25,
          pomodoroCount:
            patch.pomodoroCount !== undefined
              ? patch.pomodoroCount
              : items[foundItemIndex].pomodoroCount || 0,
        };
        ActionItems.storage.set(
          {
            actionItems: items,
          },
          callback
        );
      }
    });
  }

  static setItems(items, callback) {
    ActionItems.storage.set(
      {
        actionItems: items,
      },
      callback
    );
  }

  static getTimerState(callback) {
    ActionItems.storage.get(
      ["activeTimerTaskId", "timerEndTime", "timerRunning", "timerMode", "timerRemainingMs"],
      (data) => callback(data)
    );
  }

  static setTimerState(timerState, callback) {
    ActionItems.storage.set(timerState, callback);
  }

  static getTabUrl(tab) {
    try {
      const url = tab && tab.url ? new URL(tab.url) : null;
      if (!url || !url.hostname) {
        return "";
      }
      if (url.protocol === "chrome:") {
        return "";
      }
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  static getValidatedFavIcon(tab, url) {
    const extractedDomain = ActionItems.getDomainFromUrl(url || (tab && tab.url));
    const favIcon = tab && tab.favIconUrl ? tab.favIconUrl : "";
    if (favIcon && !favIcon.startsWith("chrome://")) {
      return favIcon;
    }
    if (extractedDomain) {
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(extractedDomain)}&sz=32`;
    }
    return "";
  }

  static getDomainFromUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (error) {
      return "";
    }
  }

  static setProgress() {
    let completedItems = 0;
    ActionItems.getCurrentItems((items) => {
      let totalItems = items.length;
      completedItems = items.filter((item) => {
        return item.completed;
      }).length;
      let progress = 0;
      if (totalItems > 0) {
        progress = parseFloat(completedItems / totalItems).toFixed(2);
      }
      const percent = Math.round(progress * 100);
      const meta = document.querySelector(".mission-progress__meta");
      const percentEl = document.querySelector(".mission-progress__percent");
      if (meta) {
        meta.textContent = `${completedItems} of ${totalItems} complete`;
      }
      if (percentEl) {
        percentEl.textContent = `${percent}%`;
      }
      ActionItems.setBrowserBadge(totalItems - completedItems);
      if (typeof window.circle !== "undefined") circle.animate(progress);
    });
  }

  static setBrowserBadge(todoItems) {
    let text = `${todoItems}`;
    if (todoItems > 9) {
      text = "9+";
    }
    chrome.action.setBadgeText({ text: text });
  }
}
