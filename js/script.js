let itemsList = document.querySelector(".actionItems");
let addItemForm = document.querySelector("#addItemForm");
let storage = chrome.storage.local;
let quickActionsState = [];
let quickActionsDraft = [];
let dragState = {
  draggedId: null,
  overId: null,
};
let timerTickHandle = null;
let currentTimerState = {
  activeTimerTaskId: "",
  timerEndTime: 0,
  timerRunning: false,
  timerMode: "",
  timerRemainingMs: 0,
};
let expandedTimerTaskId = "";
let timerCompletionHandled = false;
const PRODUCTIVITY_FAVICONS = [
  { label: "Google", domain: "google.com" },
  { label: "Notion", domain: "notion.so" },
  { label: "Spotify", domain: "spotify.com" },
  { label: "GitHub", domain: "github.com" },
  { label: "YouTube", domain: "youtube.com" },
  { label: "Gmail", domain: "gmail.com" },
];
const FALLBACK_ICON_CLASS = "fas fa-star";
const MODAL_VISIBLE_CLASS = "modal-open-visible";

const showModal = (id) => {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add(MODAL_VISIBLE_CLASS);
  const focusTarget = modal.querySelector("input, button, textarea, select");
  if (focusTarget) {
    requestAnimationFrame(() => focusTarget.focus());
  }
};
const hideModal = (id) => {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove(MODAL_VISIBLE_CLASS);
};
const initializeModalDismissListeners = () => {
  document.querySelectorAll('[data-dismiss="modal"]').forEach((button) => {
    button.addEventListener("click", () => {
      const modal = button.closest(".modal");
      if (modal && modal.id) {
        hideModal(modal.id);
        if (modal.id === "quickActionsModal") {
          quickActionsDraft = [];
        }
      }
    });
  });
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        hideModal(modal.id);
        if (modal.id === "quickActionsModal") {
          quickActionsDraft = [];
        }
      }
    });
  });
};

const todayKey = () => new Date().toISOString().slice(0, 10);
const yesterdayKey = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
};
const dayKey = (value) => new Date(value).toISOString().slice(0, 10);

const safeItems = (items) => Array.isArray(items) ? items : [];
const safeQuickActions = (actions) => Array.isArray(actions) ? actions : [];

const faviconUrlForDomain = (domain) => {
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
};

const normalizeFaviconInput = (value) => {
  const raw = (value || "").trim();
  if (!raw) return null;
  let domain = raw;
  try {
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      domain = raw.includes("/") ? raw.split("/")[0] : raw;
    } else {
      domain = new URL(raw).hostname;
    }
  } catch (error) {
    domain = raw.split("/")[0];
  }
  if (!domain) return null;
  return {
    type: "favicon",
    url: faviconUrlForDomain(domain),
    domain: domain,
  };
};

const iconUrlFromIcon = (icon) => {
  if (icon && icon.type === "favicon" && icon.url) return icon.url;
  return "";
};

const renderIconMarkup = (icon, className = "") => {
  const url = iconUrlFromIcon(icon);
  if (url) {
    return `<img src="${url}" alt="" class="${className}">`;
  }
  return `<i class="${FALLBACK_ICON_CLASS} ${className}"></i>`;
};

const createIconElement = (icon, fallbackUrl) => {
  const img = document.createElement("img");
  img.alt = "";
  img.src = iconUrlFromIcon(icon) || fallbackUrl || "";
  img.onerror = () => {
    if (fallbackUrl && img.src !== fallbackUrl) {
      img.onerror = () => {
        const linkIcon = document.createElement("i");
        linkIcon.className = "fas fa-link";
        img.replaceWith(linkIcon);
      };
      img.src = fallbackUrl;
      return;
    }
    const linkIcon = document.createElement("i");
    linkIcon.className = "fas fa-link";
    img.replaceWith(linkIcon);
  };
  return img;
};

const getDomainFromUrl = (url) => {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return "";
  }
};

const getFallbackFaviconUrl = (url) => {
  const domain = getDomainFromUrl(url);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
};

const normalizeQuickAction = (action) => ({
  ...action,
  icon: action.icon && action.icon.type === "favicon" ? action.icon : null,
});

const DEFAULT_FOCUS_DURATION = 25;
const TIMER_ALARM = "pomodoroTimerAlarm";

const setUsersName = (savedName) => {
  let name = savedName ? savedName : "Add Name";
  document.querySelector(".name__value").innerText = name;
};

const getActiveTab = () => {
  return new Promise((resolve) => {
    chrome.tabs.query(
      { active: true, currentWindow: true },
      function (tabs) {
        resolve(tabs[0]);
      }
    );
  });
};

const getLinkWebsite = async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.url || tab.title === "New Tab") {
    return null;
  }
  return {
    url: tab.url,
    fav_icon: tab.favIconUrl,
    title: tab.title,
  };
};

const buildTaskOrder = (items) => items.map((item) => item.id);

const sortFilterActionItems = (actionItems) => {
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const filteredItems = safeItems(actionItems).filter((item) => {
    if (item.completed) {
      const completedDate = new Date(item.completed);
      if (completedDate < currentDate) {
        return false;
      }
    }
    return true;
  });
  return filteredItems;
};

const applyTaskOrdering = (items, taskOrder) => {
  const order = safeItems(taskOrder);
  const ordered = [...items].sort((a, b) => {
    const aIndex = order.indexOf(a.id);
    const bIndex = order.indexOf(b.id);
    if (aIndex === -1 && bIndex === -1) {
      return new Date(b.added) - new Date(a.added);
    }
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  return ordered;
};

const persistTaskOrder = (items) => {
  storage.set({
    taskOrder: buildTaskOrder(items),
  });
};

const getTimerRemainingSeconds = () => {
  if (!currentTimerState.timerEndTime) return 0;
  return Math.max(0, Math.ceil((Number(currentTimerState.timerEndTime) - Date.now()) / 1000));
};

const formatTimer = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const syncTimerFromStorage = (callback) => {
  ActionItems.getTimerState((timerState) => {
    currentTimerState = {
      activeTimerTaskId: timerState.activeTimerTaskId || "",
      timerEndTime: Number(timerState.timerEndTime || 0),
      timerRunning: !!timerState.timerRunning,
      timerMode: timerState.timerMode || "",
      timerRemainingMs: Number(timerState.timerRemainingMs || 0),
    };
    if (callback) callback();
  });
};

const clearTimerTick = () => {
  if (timerTickHandle) {
    clearInterval(timerTickHandle);
    timerTickHandle = null;
  }
};

const clearTimerCompletionFlag = () => {
  timerCompletionHandled = false;
};

const refreshTimerStateFromStorage = (callback) => {
  syncTimerFromStorage(() => {
    applyTimerUiState();
    if (callback) callback();
  });
};

const toggleTimerRow = (taskId) => {
  if (expandedTimerTaskId === taskId) {
    expandedTimerTaskId = "";
  } else {
    expandedTimerTaskId = taskId;
  }
  applyTimerUiState();
};

const renderFocusBanner = () => {
  storage.get(["focusBannerText", "focusBannerExpiresAt"], (data) => {
    const banner = document.querySelector("#carryOverBanner");
    if (data.focusBannerText && Date.now() < Number(data.focusBannerExpiresAt || 0)) {
      banner.classList.remove("d-none");
      banner.classList.remove("carry-over-banner");
      banner.classList.add("focus-banner");
      banner.replaceChildren();
      const text = document.createElement("div");
      text.className = "carry-over-banner__text";
      text.textContent = data.focusBannerText;
      banner.appendChild(text);
      setTimeout(() => {
        banner.classList.add("d-none");
        banner.classList.remove("focus-banner");
        banner.classList.add("carry-over-banner");
      }, 4000);
    }
  });
};

const buildTimerIcon = (iconClass) => `<i class="${iconClass}"></i>`;
const buildTomatoIcon = () => `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#e74c3c" class="actionItem__tomatoIcon" aria-hidden="true">
    <path d="M12 2C8 2 4 6 4 11c0 5 3 9 8 10 5-1 8-5 8-10 0-5-4-9-8-9z"></path>
    <path d="M12 2 c0 0 2-3 5-2" stroke="#2ecc71" stroke-width="2" fill="none"></path>
  </svg>
`;

const persistTimerState = (nextState, callback) => {
  ActionItems.setTimerState(nextState, callback);
};

const updateBadgeToTodoCount = () => {
  ActionItems.setProgress();
};

const applyTimerUiState = () => {
  document.querySelectorAll(".actionItem__item").forEach((card) => {
    const taskId = card.dataset.id;
    const timerRow = card.querySelector(".actionItem__timer");
    const control = card.querySelector(".actionItem__timerControl");
    const timerPlay = card.querySelector(".actionItem__timerPlay");
    const timerPause = card.querySelector(".actionItem__timerPause");
    const durationToggle = card.querySelector(".actionItem__focusDurationToggle");
    const durationLabel = card.querySelector(".actionItem__focusDurationLabel");
    const durationValue = card.querySelector(".actionItem__focusDurationValue");
    const tomatoCount = card.querySelector(".actionItem__pomodoroCount");
    const isActive = taskId === currentTimerState.activeTimerTaskId;
    const isExpanded = isActive || taskId === expandedTimerTaskId;
    card.classList.toggle("timer-active", isActive);
    card.classList.toggle("timer-expanded", isExpanded);
    if (timerRow) timerRow.classList.toggle("d-none", !isExpanded);
    if (control) {
      control.innerHTML = buildTimerIcon("fas fa-clock");
    }
    if (durationToggle) {
      durationToggle.classList.toggle("d-none", isActive && currentTimerState.timerRunning);
    }
    if (durationLabel && durationValue) {
      durationValue.textContent = formatFocusDuration(card.dataset.focusDuration || DEFAULT_FOCUS_DURATION);
      durationLabel.textContent = `${durationValue.textContent} min`;
    }
    if (tomatoCount) {
      tomatoCount.innerHTML = `${buildTomatoIcon()} <span>${card.dataset.pomodoroCount || 0}</span>`;
    }
    const countdown = card.querySelector(".actionItem__countdown");
    if (countdown) {
      if (isActive) {
        countdown.textContent = formatTimer(getTimerRemainingSeconds());
      } else if (isExpanded) {
        countdown.textContent = `${String(formatFocusDuration(card.dataset.focusDuration || DEFAULT_FOCUS_DURATION)).padStart(2, "0")}:00`;
      }
    }
    if (timerPlay) {
      timerPlay.innerHTML = isActive && currentTimerState.timerRunning ? buildTimerIcon("fas fa-pause") : buildTimerIcon("fas fa-play");
    }
    if (timerPause) {
      timerPause.classList.toggle("d-none", !(isActive || taskId === expandedTimerTaskId));
    }
  });
};

const startTimerTick = () => {
  clearTimerTick();
  timerTickHandle = setInterval(() => {
    if (!currentTimerState.activeTimerTaskId) return;
    const remaining = getTimerRemainingSeconds();
    const activeCard = document.querySelector(`.actionItem__item[data-id="${currentTimerState.activeTimerTaskId}"]`);
    if (activeCard) {
      const countdown = activeCard.querySelector(".actionItem__countdown");
      if (countdown) countdown.textContent = formatTimer(remaining);
    }
    if (remaining <= 0) {
      clearTimerTick();
      handleTimerCompletion();
    }
  }, 1000);
};

const loadTimerStateAndRender = () => {
  syncTimerFromStorage(() => {
    if (currentTimerState.activeTimerTaskId && currentTimerState.timerEndTime <= Date.now()) {
      handleTimerCompletion();
      return;
    }
    if (currentTimerState.activeTimerTaskId) {
      expandedTimerTaskId = currentTimerState.activeTimerTaskId;
    }
    renderFocusBanner();
    applyTimerUiState();
    if (currentTimerState.activeTimerTaskId && currentTimerState.timerRunning) {
      startTimerTick();
    } else {
      clearTimerTick();
    }
  });
};

const handleStorageChangeSync = (changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.activeTimerTaskId || changes.timerEndTime || changes.timerRunning || changes.timerMode || changes.timerRemainingMs) {
    loadTimerStateAndRender();
  }
  if (changes.actionItems || changes.taskOrder) {
    refreshTasks();
  }
  if (changes.focusBannerText || changes.focusBannerExpiresAt) {
    renderFocusBanner();
  }
};

const collapseTimerCard = (taskId) => {
  const card = document.querySelector(`.actionItem__item[data-id="${taskId}"]`);
  if (!card) return;
  card.classList.remove("timer-active");
  const timerRow = card.querySelector(".actionItem__timer");
  if (timerRow) timerRow.classList.add("d-none");
};

const clearActiveTimer = (callback) => {
  const previousTaskId = currentTimerState.activeTimerTaskId;
  if (previousTaskId) {
    collapseTimerCard(previousTaskId);
  }
  chrome.alarms.clear(TIMER_ALARM, () => {
    persistTimerState(
      {
        activeTimerTaskId: "",
        timerEndTime: 0,
        timerRunning: false,
        timerMode: "",
        timerRemainingMs: 0,
      },
      () => {
        currentTimerState = {
          activeTimerTaskId: "",
          timerEndTime: 0,
          timerRunning: false,
          timerMode: "",
          timerRemainingMs: 0,
        };
        loadTimerStateAndRender();
        if (callback) callback();
      }
    );
  });
};

const handleTimerCompletion = () => {
  if (timerCompletionHandled) return;
  timerCompletionHandled = true;
  clearTimerTick();
  chrome.alarms.clear(TIMER_ALARM);
  syncTimerFromStorage(() => {
    const taskId = currentTimerState.activeTimerTaskId;
    if (!taskId) return;
    loadTaskById(taskId, (item) => {
      if (!item) {
        clearTimerCompletionFlag();
        return;
      }
      ActionItems.updateItem(
        taskId,
        {
          pomodoroCount: (item.pomodoroCount || 0) + 1,
        },
        () => {
          storage.set({
            focusBannerText: `Focus session complete for: ${item.text} ✓`,
            focusBannerExpiresAt: Date.now() + 4000,
          });
          persistTimerState(
            {
              activeTimerTaskId: "",
              timerEndTime: 0,
              timerRunning: false,
              timerMode: "",
              timerRemainingMs: 0,
            },
            () => {
              currentTimerState = {
                activeTimerTaskId: "",
                timerEndTime: 0,
                timerRunning: false,
                timerMode: "",
                timerRemainingMs: 0,
              };
              refreshTasks();
              ActionItems.setProgress();
              chrome.action.setBadgeText({ text: "✓" });
              setTimeout(() => {
                ActionItems.setProgress();
                clearTimerCompletionFlag();
              }, 3000);
            }
          );
        }
      );
    });
  });
};

const renderQuickActions = () => {
  const wrapper = document.querySelector("#quickActionsList");
  wrapper.innerHTML = "";
  quickActionsState.forEach((quickAction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-action btn btn-outline-dark btn-sm";
    button.dataset.id = quickAction.id;
    button.dataset.text = quickAction.text;
    button.dataset.label = quickAction.label;
    button.dataset.isLinkAction = quickAction.isLinkAction ? "true" : "false";
    const icon = createIconElement(quickAction.icon, "");
    icon.className = "quick-action__icon";
    button.appendChild(icon);
    button.appendChild(document.createTextNode(` ${quickAction.label}`));
    button.addEventListener("click", handleQuickActionListener);
    wrapper.appendChild(button);
  });
};

const loadTaskById = (taskId, callback) => {
  ActionItems.getCurrentItems((items) => {
    const item = items.find((entry) => entry.id === taskId);
    callback(item, items);
  });
};

const getCurrentTaskTimerState = (taskId) =>
  new Promise((resolve) => {
    ActionItems.getTimerState((timerState) => {
      resolve({
        activeTimerTaskId: timerState.activeTimerTaskId || "",
        timerEndTime: Number(timerState.timerEndTime || 0),
        timerRunning: !!timerState.timerRunning,
        timerMode: timerState.timerMode || "",
        timerRemainingMs: Number(timerState.timerRemainingMs || 0),
        isThisTask: timerState.activeTimerTaskId === taskId,
      });
    });
  });

const formatFocusDuration = (minutes) => {
  const value = Math.max(10, Math.min(60, parseInt(minutes, 10) || DEFAULT_FOCUS_DURATION));
  return value;
};

const cycleFocusDuration = (current) => {
  const value = formatFocusDuration(current);
  if (value === 25) return 45;
  if (value === 45) return 10;
  return 25;
};

const startOrTogglePomodoro = (taskId) => {
  loadTaskById(taskId, (item) => {
    if (!item) return;
    const isRunningOnThisTask =
      currentTimerState.activeTimerTaskId === taskId && currentTimerState.timerRunning;
    const isPausedOnThisTask =
      currentTimerState.activeTimerTaskId === taskId && !currentTimerState.timerRunning && currentTimerState.timerRemainingMs > 0;

    if (isRunningOnThisTask) {
      const remainingMs = Math.max(0, currentTimerState.timerEndTime - Date.now());
      clearTimerTick();
      persistTimerState({
        activeTimerTaskId: taskId,
        timerEndTime: currentTimerState.timerEndTime,
        timerRunning: false,
        timerMode: "focus",
        timerRemainingMs: remainingMs,
      }, () => {
        chrome.alarms.clear(TIMER_ALARM, loadTimerStateAndRender);
      });
      return;
    }

    if (isPausedOnThisTask) {
      const remainingMs = Number(currentTimerState.timerRemainingMs || 0) || Math.max(0, currentTimerState.timerEndTime - Date.now());
      if (remainingMs <= 0) {
        clearActiveTimer(() => startOrTogglePomodoro(taskId));
        return;
      }
      const resumeEndTime = Date.now() + remainingMs;
      clearTimerTick();
      persistTimerState({
        activeTimerTaskId: taskId,
        timerEndTime: resumeEndTime,
        timerRunning: true,
        timerMode: "focus",
        timerRemainingMs: remainingMs,
      }, () => {
        chrome.alarms.clear(TIMER_ALARM, () => {
          chrome.alarms.create(TIMER_ALARM, { when: resumeEndTime });
        });
        loadTimerStateAndRender();
      });
      return;
    }

    const duration = formatFocusDuration(item.focusDuration || DEFAULT_FOCUS_DURATION);
    const endTime = Date.now() + duration * 60 * 1000;
    const beginTimer = () => {
      persistTimerState(
        {
          activeTimerTaskId: taskId,
          timerEndTime: endTime,
          timerRunning: true,
          timerMode: "focus",
          timerRemainingMs: duration * 60 * 1000,
        },
        () => {
          chrome.alarms.create(TIMER_ALARM, { when: endTime });
          loadTimerStateAndRender();
        }
      );
    };
    if (currentTimerState.activeTimerTaskId && currentTimerState.activeTimerTaskId !== taskId) {
      clearTimerTick();
      clearActiveTimer(() => {
        beginTimer();
      });
      return;
    }
    clearTimerTick();
    chrome.alarms.clear(TIMER_ALARM, beginTimer);
  });
};

const onTimerPlayClick = async (taskId) => {
  const timerState = await getCurrentTaskTimerState(taskId);
  if (timerState.isThisTask && !timerState.timerRunning && timerState.timerRemainingMs <= 0) {
    // Stale zero-state; start a fresh session.
    expandedTimerTaskId = taskId;
    startOrTogglePomodoro(taskId);
    return;
  }
  startOrTogglePomodoro(taskId);
};

const cancelPomodoro = () => {
  clearTimerTick();
  chrome.alarms.clear(TIMER_ALARM);
  persistTimerState(
    {
      activeTimerTaskId: "",
      timerEndTime: 0,
      timerRunning: false,
      timerMode: "",
      timerRemainingMs: 0,
    },
    loadTimerStateAndRender
  );
};

const loadQuickActions = (callback) => {
  ActionItems.getQuickActions((actions) => {
    quickActionsState = safeQuickActions(actions).map(normalizeQuickAction);
    renderQuickActions();
    if (callback) callback();
  });
};

const makeQuickAction = () => ({
  id: uuidv4(),
  label: "New action",
  text: "Add task",
  isLinkAction: false,
  icon: null,
});

const getQuickActionPreviewMarkup = (action) => {
  return `${renderIconMarkup(action.icon, "quick-action-preview__icon")} ${action.label || "New action"}`;
};

const buildQuickActionEditorRow = (quickAction) => {
  const row = document.createElement("div");
  row.className = "quick-action-card";
  row.dataset.id = quickAction.id;
  const summary = document.createElement("div");
  summary.className = "quick-action-card__summary";
  const summaryIcon = document.createElement("div");
  summaryIcon.className = "quick-action-card__icon";
  const summaryLabel = document.createElement("div");
  summaryLabel.className = "quick-action-card__label";
  const summaryActions = document.createElement("div");
  summaryActions.className = "quick-action-card__actions";
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "btn btn-outline-dark btn-sm qa-edit";
  editButton.textContent = "Edit";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-outline-danger btn-sm qa-delete";
  deleteButton.textContent = "Delete";
  summaryActions.append(editButton, deleteButton);
  summaryIcon.innerHTML = renderIconMarkup(quickAction.icon, "quick-action-card__icon-img");
  summaryLabel.textContent = quickAction.label || "New action";
  summary.append(summaryIcon, summaryLabel, summaryActions);

  const body = document.createElement("div");
  body.className = "quick-action-card__body";

  const labelField = document.createElement("div");
  labelField.className = "quick-action-card__field";
  const labelFieldLabel = document.createElement("label");
  labelFieldLabel.textContent = "Button name";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "form-control qa-label";
  labelInput.value = quickAction.label || "";
  labelField.append(labelFieldLabel, labelInput);

  const textField = document.createElement("div");
  textField.className = "quick-action-card__field";
  const textFieldLabel = document.createElement("label");
  textFieldLabel.textContent = "Task added when clicked";
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "form-control qa-text";
  textInput.value = quickAction.text || "";
  textField.append(textFieldLabel, textInput);

  const toggleField = document.createElement("div");
  toggleField.className = "quick-action-card__field quick-action-toggle";
  const switchWrap = document.createElement("div");
  switchWrap.className = "custom-control custom-switch";
  const linkInput = document.createElement("input");
  linkInput.type = "checkbox";
  linkInput.className = "custom-control-input qa-link";
  linkInput.id = `qa-link-${quickAction.id}`;
  linkInput.checked = !!quickAction.isLinkAction;
  const linkLabel = document.createElement("label");
  linkLabel.className = "custom-control-label";
  linkLabel.setAttribute("for", linkInput.id);
  linkLabel.textContent = "Capture current tab when clicked";
  switchWrap.append(linkInput, linkLabel);
  toggleField.appendChild(switchWrap);

  const iconField = document.createElement("div");
  iconField.className = "quick-action-card__field";
  const iconFieldLabel = document.createElement("label");
  iconFieldLabel.textContent = "Search for an app or site (e.g. Spotify, Gmail)";
  const iconSearch = document.createElement("input");
  iconSearch.type = "text";
  iconSearch.className = "form-control qa-icon-search";
  iconSearch.placeholder = "Search for an app or site (e.g. Spotify, Gmail)";
  iconSearch.value = quickAction.icon && quickAction.icon.domain ? quickAction.icon.domain : "";
  iconSearch.disabled = !!quickAction.isLinkAction;
  const suggestions = document.createElement("div");
  suggestions.className = "quick-action-icon-suggestions";
  PRODUCTIVITY_FAVICONS.forEach((item) => {
    const suggestion = document.createElement("button");
    suggestion.type = "button";
    suggestion.className = "quick-action-icon-suggestion";
    suggestion.dataset.domain = item.domain;
    suggestion.textContent = item.label;
    suggestions.appendChild(suggestion);
  });
  iconField.append(iconFieldLabel, iconSearch, suggestions);

  const previewField = document.createElement("div");
  previewField.className = "quick-action-card__field";
  const previewFieldLabel = document.createElement("label");
  previewFieldLabel.textContent = "Live preview";
  const previewWrap = document.createElement("div");
  previewWrap.className = "quick-action-preview";
  const previewText = document.createElement("span");
  previewText.className = "quick-action-preview__label";
  previewText.textContent = "Button preview";
  const previewButton = document.createElement("button");
  previewButton.type = "button";
  previewButton.className = "quick-action btn btn-outline-dark btn-sm quick-action-preview__button";
  previewButton.disabled = true;
  previewWrap.append(previewText, previewButton);
  previewField.append(previewFieldLabel, previewWrap);

  body.append(labelField, textField, toggleField, iconField, previewField);
  row.append(summary, body);

  const refreshPreview = () => {
    const icon = quickAction.icon;
    const label = labelInput.value.trim() || "Quick action";
    const text = textInput.value.trim() || label;
    summaryIcon.innerHTML = renderIconMarkup(icon, "quick-action-card__icon-img");
    summaryLabel.textContent = label;
    previewButton.replaceChildren();
    const previewIconWrap = document.createElement("span");
    previewIconWrap.innerHTML = renderIconMarkup(icon, "quick-action-preview__icon");
    previewButton.appendChild(previewIconWrap.firstElementChild);
    previewButton.appendChild(document.createTextNode(` ${label}`));
    row.dataset.icon = JSON.stringify(icon || {});
    row.dataset.text = text;
  };

  editButton.addEventListener("click", () => {
    row.classList.toggle("expanded");
  });
  deleteButton.addEventListener("click", () => {
    quickActionsDraft = quickActionsDraft.filter((action) => action.id !== quickAction.id);
    renderQuickActionsEditor();
  });
  labelInput.addEventListener("input", refreshPreview);
  textInput.addEventListener("input", refreshPreview);
  const applyIconDomain = (domainValue) => {
    const icon = normalizeFaviconInput(domainValue);
    quickAction.icon = icon;
    refreshPreview();
  };
  iconSearch.addEventListener("input", (e) => {
    applyIconDomain(e.target.value);
  });
  row.querySelectorAll(".quick-action-icon-suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      iconSearch.value = button.dataset.domain;
      applyIconDomain(button.dataset.domain);
    });
  });
  refreshPreview();
  return row;
};

const renderQuickActionsEditor = () => {
  const editor = document.querySelector("#quickActionsEditor");
  editor.innerHTML = "";
  quickActionsDraft.forEach((quickAction) => {
    editor.appendChild(buildQuickActionEditorRow(quickAction));
  });
  document.querySelector("#addQuickActionBtn").disabled = quickActionsDraft.length >= 6;
};

const saveQuickActionsFromEditor = () => {
  const editorRows = document.querySelectorAll(".quick-action-card");
  const nextQuickActions = [];
  editorRows.forEach((row) => {
    const id = row.dataset.id || uuidv4();
    const label = row.querySelector(".qa-label").value.trim() || "Quick action";
    const text = row.querySelector(".qa-text").value.trim() || label;
    const isLinkAction = row.querySelector(".qa-link").checked;
    let icon = null;
    try {
      icon = JSON.parse(row.dataset.icon || "{}");
      if (!icon.url || icon.type !== "favicon") {
        icon = null;
      }
    } catch (error) {
      icon = null;
    }
    nextQuickActions.push({ id, label, text, isLinkAction, icon });
  });
  quickActionsState = nextQuickActions.slice(0, 6);
  ActionItems.setQuickActions(quickActionsState, () => {
    renderQuickActions();
  });
  hideModal("quickActionsModal");
};

const createUpdateNameDialogListener = () => {
  const greetingName = document.querySelector(".greeting__name");
  const nameValue = document.querySelector(".name__value");
  const penIcon = document.querySelector(".greeting__name .fa-pen");
  const openNameModal = () => {
    const input = document.getElementById("input__name");
    input.value = nameValue.innerText;
    showModal("updateNameModal");
    input.select();
  };
  if (greetingName) {
    greetingName.addEventListener("click", openNameModal);
  }
  if (penIcon) {
    penIcon.addEventListener("click", (event) => {
      event.stopPropagation();
      openNameModal();
    });
  }
  const nameInput = document.getElementById("input__name");
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleUpdateName();
    }
  });
};

const createUpdateNameListener = () => {
  const element = document.querySelector("#update-name");
  element.addEventListener("click", handleUpdateName);
};

const handleUpdateName = () => {
  const name = document.getElementById("input__name").value;
  if (name) {
    ActionItems.saveName(name, () => {
      setUsersName(name);
    });
    hideModal("updateNameModal");
  }
};

const handleQuickActionListener = async (e) => {
  const button = e.currentTarget;
  const text = button.dataset.text;
  const isLinkAction = button.dataset.isLinkAction === "true";
  if (isLinkAction) {
    const website = await getLinkWebsite();
    if (!website) return;
    ActionItems.add(
      {
        id: uuidv4(),
        added: new Date().toString(),
        completed: null,
        text: text,
        website: website,
      },
      refreshTasks
    );
    return;
  }
  ActionItems.addQuickActionItem(button.dataset.id, text, null, () => {
    refreshTasks();
  });
};

const createQuickActionListener = () => {
  document.querySelector("#editQuickActions").addEventListener("click", () => {
    quickActionsDraft = quickActionsState.map((action) => ({ ...action }));
    renderQuickActionsEditor();
    showModal("quickActionsModal");
  });
  document.querySelector("#addQuickActionBtn").addEventListener("click", () => {
    if (quickActionsDraft.length >= 6) return;
    quickActionsDraft.push(makeQuickAction());
    renderQuickActionsEditor();
    const rows = document.querySelectorAll(".quick-action-card");
    const last = rows[rows.length - 1];
    if (last) {
      last.classList.add("expanded");
      last.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
  document.querySelector("#saveQuickActionsBtn").addEventListener("click", saveQuickActionsFromEditor);
};

const renderActionItems = (actionItems, taskOrder = []) => {
  itemsList.innerHTML = "";
  const filteredItems = sortFilterActionItems(actionItems);
  const sortedActionItems = applyTaskOrdering(filteredItems, taskOrder);
  sortedActionItems.forEach((doc) => {
    renderActionItem(doc);
  });
};

const refreshTasks = () => {
  storage.get(["actionItems", "taskOrder"], (data) => {
    renderActionItems(data.actionItems || [], data.taskOrder || []);
    ActionItems.setProgress();
    loadTimerStateAndRender();
  });
};

const handleCompletedEventListener = (e) => {
  const parent = e.currentTarget.closest(".actionItem__item");
  const id = parent.getAttribute("data-id");
  if (parent.classList.contains("completed")) {
    ActionItems.markUnmarkCompleted(id, null, refreshTasks);
  } else {
    if (currentTimerState.activeTimerTaskId === id) {
      cancelPomodoro();
    }
    ActionItems.markUnmarkCompleted(id, new Date().toString(), refreshTasks);
  }
};

const handleDeleteEventListener = (e) => {
  const parent = e.currentTarget.closest(".actionItem__item");
  const id = parent.getAttribute("data-id");
  const jElement = document.querySelector(`div[data-id="${id}"]`);
  if (currentTimerState.activeTimerTaskId === id) {
    cancelPomodoro();
  }
  ActionItems.remove(id, () => {
    animateUp(jElement);
    refreshTasks();
  });
};

const handleAttachLink = async (e) => {
  const parent = e.currentTarget.closest(".actionItem__item");
  const id = parent.getAttribute("data-id");
  const currentItems = await new Promise((resolve) => {
    ActionItems.getCurrentItems(resolve);
  });
  const item = currentItems.find((entry) => entry.id == id);
  if (!item) return;
  if (item.website) {
    ActionItems.updateItem(id, { website: null }, refreshTasks);
    return;
  }
  const website = await getLinkWebsite();
  if (!website) return;
  ActionItems.updateItem(id, { website }, refreshTasks);
};

const attachTaskDragHandlers = (element) => {
  element.draggable = false;
  const dragHandle = element.querySelector(".actionItem__drag");
  dragHandle.draggable = true;
  dragHandle.addEventListener("dragstart", (e) => {
    const target = e.currentTarget.closest(".actionItem__item");
    dragState.draggedId = target.dataset.id;
    target.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragState.draggedId);
  });
  dragHandle.addEventListener("dragend", (e) => {
    const target = e.currentTarget.closest(".actionItem__item");
    target.classList.remove("dragging");
    document.querySelectorAll(".drop-indicator").forEach((indicator) => indicator.remove());
    dragState.draggedId = null;
    dragState.overId = null;
  });
  element.addEventListener("dragover", (e) => {
    e.preventDefault();
    const target = e.currentTarget;
    const indicator = document.querySelector(".drop-indicator");
    if (indicator) indicator.remove();
    const line = document.createElement("div");
    line.className = "drop-indicator";
    target.parentElement.insertBefore(line, target);
    dragState.overId = target.dataset.id;
  });
  element.addEventListener("drop", (e) => {
    e.preventDefault();
    const droppedId = dragState.draggedId;
    const targetId = e.currentTarget.dataset.id;
    if (!droppedId || !targetId || droppedId === targetId) return;
    storage.get(["actionItems"], (data) => {
      const items = safeItems(data.actionItems);
      const draggedIndex = items.findIndex((item) => item.id == droppedId);
      const targetIndex = items.findIndex((item) => item.id == targetId);
      if (draggedIndex < 0 || targetIndex < 0) return;
      const [moved] = items.splice(draggedIndex, 1);
      items.splice(targetIndex, 0, moved);
      ActionItems.setItems(items, () => {
        persistTaskOrder(items);
        refreshTasks();
      });
    });
  });
};

const startInlineEdit = (textEl) => {
  const parent = textEl.closest(".actionItem__item");
  const id = parent.dataset.id;
  const originalValue = textEl.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control actionItem__editInput";
  input.value = originalValue;
  textEl.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  const commit = () => {
    const nextValue = input.value.trim();
    if (!nextValue) {
      input.replaceWith(textEl);
      return;
    }
    ActionItems.updateItem(id, { text: nextValue }, refreshTasks);
  };
  const cancel = () => {
    input.replaceWith(textEl);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commit();
    }
    if (e.key === "Escape") {
      cancel();
    }
  });
  input.addEventListener("blur", commit);
};

const renderActionItem = (item, animateDuration = 500) => {
  let element = document.createElement("div");
  let mainElement = document.createElement("div");
  let deleteEl = document.createElement("button");
  let checkEl = document.createElement("div");
  let dragEl = document.createElement("div");
  let timerEl = document.createElement("button");
  let textEl = document.createElement("div");
  let linkEl = document.createElement("button");
  let timerRowEl = document.createElement("div");
  let timerDisplayEl = document.createElement("div");
  let timerControlsEl = document.createElement("div");
  let durationToggleEl = document.createElement("button");
  let durationLabelEl = document.createElement("span");
  let durationValueEl = document.createElement("span");
  mainElement.classList.add("actionItem__main");
  element.classList.add("actionItem__item");
  deleteEl.classList.add("actionItem__delete", "actionItem__iconButton");
  checkEl.classList.add("actionItem__check");
  dragEl.classList.add("actionItem__drag");
  timerEl.classList.add("actionItem__timerControl", "actionItem__iconButton");
  textEl.classList.add("actionItem__text");
  linkEl.classList.add("actionItem__linkBtn", "actionItem__iconButton");
  timerRowEl.classList.add("actionItem__timer", "d-none");
  timerDisplayEl.classList.add("actionItem__countdown");
  timerControlsEl.classList.add("actionItem__timerControls");
  durationToggleEl.classList.add("actionItem__focusDurationToggle");
  durationLabelEl.classList.add("actionItem__focusDurationLabel");
  durationValueEl.classList.add("actionItem__focusDurationValue");
  element.setAttribute("data-id", item.id);
  element.dataset.focusDuration = item.focusDuration || DEFAULT_FOCUS_DURATION;
  element.dataset.pomodoroCount = item.pomodoroCount || 0;
  if (item.completed) {
    element.classList.add("completed");
  }
  dragEl.innerHTML = `<i class="fas fa-grip-vertical"></i>`;
  checkEl.innerHTML = `<div class="actionItem__checkBox"><i class="fas fa-check"></i></div>`;
  deleteEl.innerHTML = `<i class="fas fa-times"></i>`;
  linkEl.innerHTML = `<i class="fas fa-link"></i>`;
  timerEl.innerHTML = buildTimerIcon("fas fa-clock");
  textEl.textContent = item.text;
  timerDisplayEl.textContent = "25:00";
  durationValueEl.textContent = formatFocusDuration(item.focusDuration || DEFAULT_FOCUS_DURATION);
  durationLabelEl.textContent = `${durationValueEl.textContent} min`;
  dragEl.setAttribute("draggable", "true");
  dragEl.title = "Drag to reorder";
  dragEl.addEventListener("mousedown", (e) => e.stopPropagation());
  dragEl.addEventListener("dragstart", (e) => e.stopPropagation());
  checkEl.addEventListener("click", handleCompletedEventListener);
  deleteEl.addEventListener("click", handleDeleteEventListener);
  linkEl.addEventListener("click", handleAttachLink);
  timerEl.addEventListener("click", () => toggleTimerRow(item.id));
  textEl.addEventListener("dblclick", () => startInlineEdit(textEl));
  durationToggleEl.type = "button";
  durationToggleEl.className = "actionItem__focusDurationToggle btn btn-link btn-sm p-0";
  durationToggleEl.innerHTML = `<span class="actionItem__focusDurationValue">${durationValueEl.textContent}</span> <span class="actionItem__focusDurationUnit">min</span>`;
  durationToggleEl.addEventListener("click", () => {
    if (currentTimerState.activeTimerTaskId === item.id && currentTimerState.timerRunning) return;
    if (currentTimerState.activeTimerTaskId === item.id && !currentTimerState.timerRunning && currentTimerState.timerRemainingMs > 0) {
      const shouldReset = window.confirm("Changing the duration will reset the paused timer. Continue?");
      if (!shouldReset) return;
      cancelPomodoro();
    }
    const current = formatFocusDuration(element.dataset.focusDuration || DEFAULT_FOCUS_DURATION);
    const next = cycleFocusDuration(current);
    element.dataset.focusDuration = next;
    durationValueEl.textContent = next;
    durationLabelEl.textContent = `${next} min`;
    durationToggleEl.innerHTML = `<span class="actionItem__focusDurationValue">${next}</span> <span class="actionItem__focusDurationUnit">min</span>`;
    ActionItems.updateItem(item.id, { focusDuration: next }, () => {
      if (currentTimerState.activeTimerTaskId === item.id && !currentTimerState.timerRunning) {
        refreshTimerStateFromStorage();
      }
    });
  });
  mainElement.appendChild(dragEl);
  mainElement.appendChild(checkEl);
  mainElement.appendChild(textEl);
  mainElement.appendChild(timerEl);
  mainElement.appendChild(linkEl);
  mainElement.appendChild(deleteEl);
  element.appendChild(mainElement);
  timerControlsEl.innerHTML = `
    <span class="actionItem__pomodoroCount">${buildTomatoIcon()} <span>${item.pomodoroCount || 0}</span></span>
    <div class="actionItem__timerActions">
      <button type="button" class="actionItem__timerPlay btn btn-link btn-sm p-0"><i class="fas fa-play"></i></button>
      <button type="button" class="actionItem__timerPause btn btn-link btn-sm p-0"><i class="fas fa-times"></i></button>
    </div>
  `;
  timerControlsEl.querySelector(".actionItem__timerPlay").addEventListener("click", () => onTimerPlayClick(item.id));
  timerControlsEl.querySelector(".actionItem__timerPause").addEventListener("click", cancelPomodoro);
  timerRowEl.appendChild(timerDisplayEl);
  timerRowEl.appendChild(durationToggleEl);
  timerRowEl.appendChild(timerControlsEl);
  element.appendChild(timerRowEl);
  if (item.website) {
    const link = createLinkContainer(
      item.website.url,
      item.website["fav_icon"],
      item.website.title
    );
    element.appendChild(link);
  }
  itemsList.appendChild(element);
  attachTaskDragHandlers(element);
  const jElement = document.querySelector(`div[data-id="${item.id}"]`);
  animateDown(jElement, animateDuration);
};

const animateUp = (element) => {
  element.style.transition = "margin-top 250ms ease, opacity 250ms ease";
  element.style.marginTop = `-${element.offsetHeight}px`;
  element.style.opacity = "0";
  element.addEventListener("transitionend", () => element.remove(), { once: true });
};

const animateDown = (element, duration) => {
  element.style.marginTop = `-${element.offsetHeight}px`;
  element.style.opacity = "0";
  element.style.transition = `margin-top ${duration}ms ease, opacity ${duration}ms ease`;
  requestAnimationFrame(() => {
    element.style.marginTop = "12px";
    element.style.opacity = "1";
  });
};

const createLinkContainer = (url, favIcon, title) => {
  let element = document.createElement("div");
  element.classList.add("actionItem__linkContainer");
  const fallbackUrl = getFallbackFaviconUrl(url);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  const link = document.createElement("div");
  link.classList.add("actionItem__link");
  const favIconContainer = document.createElement("div");
  favIconContainer.classList.add("actionItem__favIcon");
  const titleContainer = document.createElement("div");
  titleContainer.classList.add("actionItem__title");
  const titleSpan = document.createElement("span");
  titleSpan.textContent = title || "";
  titleContainer.appendChild(titleSpan);
  link.append(favIconContainer, titleContainer);
  anchor.appendChild(link);
  element.appendChild(anchor);
  const iconContainer = element.querySelector(".actionItem__favIcon");
  const img = document.createElement("img");
  img.alt = "";
  img.src = favIcon || fallbackUrl || "";
  img.onerror = () => {
    if (fallbackUrl && img.src !== fallbackUrl) {
      img.onerror = () => {
        const icon = document.createElement("i");
        icon.className = "fas fa-link";
        img.replaceWith(icon);
      };
      img.src = fallbackUrl;
      return;
    }
    const icon = document.createElement("i");
    icon.className = "fas fa-link";
    img.replaceWith(icon);
  };
  iconContainer.appendChild(img);
  return element;
};

const setGreetingImage = () => {
  const image = document.getElementById("greeting__image");
  const date = new Date();
  const hours = date.getHours();
  if (hours >= 5 && hours <= 11) {
    image.src = "./images/good-morning.png";
  } else if (hours >= 12 && hours <= 16) {
    image.src = "./images/good-afternoon.png";
  } else if (hours >= 17 && hours <= 20) {
    image.src = "./images/good-evening.png";
  } else {
    image.src = "./images/good-night.png";
  }
};

const setGreeting = () => {
  let greeting = "Good ";
  const date = new Date();
  const hours = date.getHours();
  if (hours >= 5 && hours <= 11) {
    greeting += "Morning,";
  } else if (hours >= 12 && hours <= 16) {
    greeting += "Afternoon,";
  } else if (hours >= 17 && hours <= 20) {
    greeting += "Evening,";
  } else {
    greeting += "Night,";
  }
  document.querySelector(".greeting__type").innerText = greeting;
};

const ensureCarryOverPrompt = () => {
  storage.get(["actionItems", "lastOpenedDate"], (data) => {
    const current = todayKey();
    const lastOpenedDate = data.lastOpenedDate || "";
    const items = safeItems(data.actionItems);
    const unfinishedYesterday = items.filter((item) => {
      return !item.completed && dayKey(item.added) === yesterdayKey();
    });
    const banner = document.querySelector("#carryOverBanner");
    if (lastOpenedDate !== current && unfinishedYesterday.length > 0) {
      banner.classList.remove("d-none");
      banner.innerHTML = `
        <div class="carry-over-banner__text">
          You have ${unfinishedYesterday.length} unfinished tasks from yesterday. Keep them?
        </div>
        <div class="carry-over-banner__actions">
          <button type="button" class="btn btn-sm btn-primary" id="keepCarryOver">Yes</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="dropCarryOver">No</button>
        </div>
      `;
      document.querySelector("#keepCarryOver").addEventListener("click", () => {
        const nextItems = items.map((item) => {
          if (!item.completed && dayKey(item.added) === yesterdayKey()) {
            return { ...item, added: new Date().toString() };
          }
          return item;
        });
        ActionItems.setItems(nextItems, refreshTasks);
        storage.set({ lastOpenedDate: current });
        banner.classList.add("d-none");
      });
      document.querySelector("#dropCarryOver").addEventListener("click", () => {
        const nextItems = items.filter((item) => !( !item.completed && dayKey(item.added) === yesterdayKey() ));
        ActionItems.setItems(nextItems, refreshTasks);
        storage.set({ lastOpenedDate: current });
        banner.classList.add("d-none");
      });
      return;
    }
    if (lastOpenedDate !== current) {
      storage.set({ lastOpenedDate: current });
    }
    banner.classList.add("d-none");
  });
};

const buildWeeklyStats = (items) => {
  const days = [];
  const counts = {};
  const labels = {};
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    days.push(key);
    counts[key] = 0;
    labels[key] = date.toLocaleDateString(undefined, { weekday: "short" });
  }
  items.forEach((item) => {
    if (!item.completed) return;
    const key = dayKey(item.completed);
    if (counts[key] !== undefined) {
      counts[key] += 1;
    }
  });
  const total = days.reduce((sum, key) => sum + counts[key], 0);
  let bestDay = days[0];
  days.forEach((day) => {
    if (counts[day] > counts[bestDay]) bestDay = day;
  });
  return { days, counts, labels, total, bestDay };
};

const renderWeeklyStats = () => {
  const panel = document.querySelector("#statsPanel");
  storage.get(["actionItems"], (data) => {
    const stats = buildWeeklyStats(safeItems(data.actionItems));
    const maxCount = Math.max(...stats.days.map((day) => stats.counts[day]), 1);
    const barWidth = 280;
    const barHeight = 120;
    const gap = 10;
    const colWidth = (barWidth - gap * 6) / 7;
    const bars = stats.days
      .map((day, index) => {
        const height = Math.max((stats.counts[day] / maxCount) * (barHeight - 24), 4);
        const x = index * (colWidth + gap);
        const y = barHeight - height;
        return `
          <g>
            <rect x="${x}" y="${y}" width="${colWidth}" height="${height}" rx="6"></rect>
            <text x="${x + colWidth / 2}" y="${barHeight + 16}" text-anchor="middle">${stats.labels[day]}</text>
            <text x="${x + colWidth / 2}" y="${y - 6}" text-anchor="middle">${stats.counts[day]}</text>
          </g>
        `;
      })
      .join("");
    panel.innerHTML = `
      <div class="stats-panel__summary">
        <strong>${stats.total}</strong> completed this week
        <span>Best day: ${stats.labels[stats.bestDay]}</span>
      </div>
      <svg viewBox="0 0 ${barWidth} ${barHeight + 26}" class="weekly-stats-chart" aria-label="Weekly completion chart">
        ${bars}
      </svg>
    `;
  });
};

const toggleStatsPanel = () => {
  const panel = document.querySelector("#statsPanel");
  panel.classList.toggle("d-none");
  if (!panel.classList.contains("d-none")) {
    renderWeeklyStats();
  }
};

const handleAddTask = (e) => {
  e.preventDefault();
  let actionText = addItemForm.itemText.value;
  if (actionText) {
    let actionItem = {
      id: uuidv4(),
      added: new Date().toString(),
      completed: null,
      text: actionText,
      website: null,
    };
    ActionItems.add(actionItem, () => {
      refreshTasks();
    });
    addItemForm.itemText.value = "";
  }
};

const loadApp = () => {
  storage.get(["actionItems", "name", "taskOrder"], (data) => {
    let actionItems = data.actionItems || [];
    setUsersName(data.name);
    setGreeting();
    setGreetingImage();
    renderActionItems(actionItems, data.taskOrder || []);
    ActionItems.setProgress();
    createQuickActionListener();
    createUpdateNameListener();
    createUpdateNameDialogListener();
    initializeModalDismissListeners();
    ensureCarryOverPrompt();
    document.querySelector("#toggleStats").addEventListener("click", toggleStatsPanel);
    storage.get(['darkMode'], (data) => {
      if (data.darkMode) document.body.classList.add('dark');
    });

    document.querySelector('#toggleDarkMode').addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark');
      storage.set({ darkMode: isDark });
      const icon = document.querySelector('#toggleDarkMode i');
      icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    });
    chrome.storage.onChanged.addListener(handleStorageChangeSync);
  });
};

addItemForm.addEventListener("submit", handleAddTask);
loadQuickActions(loadApp);
loadTimerStateAndRender();
