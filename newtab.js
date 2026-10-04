const MAX_GOALS = 3;
const MAX_LINKS = 24;
const STORAGE_KEY = "goalCountdownTab";

const defaultState = () => ({
  goals: [null, null, null],
  links: [],
});

const $ = (id) => document.getElementById(id);

const goalsEl = $("goals");
const linksEl = $("links");
const goalModal = $("goal-modal");
const linkModal = $("link-modal");
const goalForm = $("goal-form");
const linkForm = $("link-form");
const goalTitleInput = $("goal-title");
const goalDatetimeInput = $("goal-datetime");
const goalClearBtn = $("goal-clear");
const linkNameInput = $("link-name");
const linkUrlInput = $("link-url");
const linkDeleteBtn = $("link-delete");
const addLinkBtn = $("add-link");

let state = defaultState();
let editingGoalIndex = null;
let editingLinkId = null;

function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const saved = result[STORAGE_KEY];
      if (!saved) {
        resolve(defaultState());
        return;
      }
      const goals = Array.from({ length: MAX_GOALS }, (_, i) => saved.goals?.[i] ?? null);
      const links = Array.isArray(saved.links) ? saved.links.slice(0, MAX_LINKS) : [];
      resolve({ goals, links });
    });
  });
}

function saveState() {
  return chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function remainingParts(targetMs, now = Date.now()) {
  const diff = Math.max(0, targetMs - now);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, reached: diff === 0 };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocal(ms) {
  const d = new Date(ms);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function normalizeUrl(raw) {
  const trimmed = raw.trim();
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).href;
  } catch {
    return null;
  }
}

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.toString();
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderGoals() {
  goalsEl.innerHTML = "";
  state.goals.forEach((goal, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "goal-card";
    button.dataset.index = String(index);

    if (!goal) {
      button.classList.add("empty");
      button.innerHTML = `<span class="plus">+</span><span>Set a goal</span>`;
      button.addEventListener("click", () => openGoalModal(index));
      goalsEl.appendChild(button);
      return;
    }

    const parts = remainingParts(goal.targetMs);
    button.innerHTML = `
      <p class="goal-title">${escapeHtml(goal.title)}</p>
      <div class="units" data-countdown="${index}">
        ${unitHtml("Days", parts.days, false)}
        ${unitHtml("Hours", parts.hours, true)}
        ${unitHtml("Mins", parts.minutes, true)}
        ${unitHtml("Secs", parts.seconds, true)}
      </div>
      <p class="reached ${parts.reached ? "" : "hidden"}">Goal reached</p>
    `;
    button.addEventListener("click", () => openGoalModal(index));
    goalsEl.appendChild(button);
  });
}

function unitHtml(label, value, padded) {
  return `
    <div class="unit">
      <span class="value">${padded ? pad(value) : value}</span>
      <span class="label">${label}</span>
    </div>
  `;
}

function tickCountdowns() {
  state.goals.forEach((goal, index) => {
    if (!goal) return;
    const root = goalsEl.querySelector(`[data-countdown="${index}"]`);
    if (!root) return;
    const parts = remainingParts(goal.targetMs);
    const values = root.querySelectorAll(".value");
    values[0].textContent = String(parts.days);
    values[1].textContent = pad(parts.hours);
    values[2].textContent = pad(parts.minutes);
    values[3].textContent = pad(parts.seconds);
    const reached = root.parentElement.querySelector(".reached");
    if (reached) reached.classList.toggle("hidden", !parts.reached);
  });
}

function renderLinks() {
  linksEl.innerHTML = "";
  if (state.links.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-links";
    empty.textContent = "No sites yet. Add the pages you open every day.";
    linksEl.appendChild(empty);
  }

  state.links.forEach((link) => {
    const tile = document.createElement("a");
    tile.className = "link-tile";
    tile.href = link.url;
    tile.title = link.url;
    tile.innerHTML = `
      <img alt="" src="${faviconUrl(link.url)}" />
      <span class="name">${escapeHtml(link.name)}</span>
      <button type="button" class="edit" aria-label="Edit ${escapeHtml(link.name)}">Edit</button>
    `;
    tile.querySelector(".edit").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLinkModal(link.id);
    });
    linksEl.appendChild(tile);
  });

  addLinkBtn.disabled = state.links.length >= MAX_LINKS;
  addLinkBtn.title = addLinkBtn.disabled ? `Maximum of ${MAX_LINKS} sites` : "";
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function openGoalModal(index) {
  editingGoalIndex = index;
  const goal = state.goals[index];
  $("goal-modal-title").textContent = goal ? "Edit goal" : "Set a goal";
  goalTitleInput.value = goal?.title ?? "";
  goalDatetimeInput.value = goal ? toDatetimeLocal(goal.targetMs) : "";
  goalClearBtn.classList.toggle("hidden", !goal);
  goalModal.showModal();
  goalTitleInput.focus();
}

function openLinkModal(id = null) {
  if (!id && state.links.length >= MAX_LINKS) return;
  editingLinkId = id;
  const link = state.links.find((item) => item.id === id);
  $("link-modal-title").textContent = link ? "Edit site" : "Add site";
  linkNameInput.value = link?.name ?? "";
  linkUrlInput.value = link?.url ?? "";
  linkDeleteBtn.classList.toggle("hidden", !link);
  linkModal.showModal();
  linkNameInput.focus();
}

goalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = goalTitleInput.value.trim();
  const datetime = goalDatetimeInput.value;
  if (!title || !datetime || editingGoalIndex === null) return;
  const targetMs = new Date(datetime).getTime();
  if (Number.isNaN(targetMs)) return;
  state.goals[editingGoalIndex] = { title, targetMs };
  await saveState();
  renderGoals();
  goalModal.close();
});

goalClearBtn.addEventListener("click", async () => {
  if (editingGoalIndex === null) return;
  state.goals[editingGoalIndex] = null;
  await saveState();
  renderGoals();
  goalModal.close();
});

linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = linkNameInput.value.trim();
  const url = normalizeUrl(linkUrlInput.value);
  if (!name || !url) {
    linkUrlInput.setCustomValidity("Enter a valid URL");
    linkUrlInput.reportValidity();
    return;
  }
  linkUrlInput.setCustomValidity("");
  if (editingLinkId) {
    state.links = state.links.map((link) =>
      link.id === editingLinkId ? { ...link, name, url } : link
    );
  } else if (state.links.length < MAX_LINKS) {
    state.links.push({ id: uid(), name, url });
  }
  await saveState();
  renderLinks();
  linkModal.close();
});

linkDeleteBtn.addEventListener("click", async () => {
  if (!editingLinkId) return;
  state.links = state.links.filter((link) => link.id !== editingLinkId);
  await saveState();
  renderLinks();
  linkModal.close();
});

$("goal-cancel").addEventListener("click", () => goalModal.close());
$("link-cancel").addEventListener("click", () => linkModal.close());
addLinkBtn.addEventListener("click", () => openLinkModal());

linkUrlInput.addEventListener("input", () => linkUrlInput.setCustomValidity(""));

async function init() {
  state = await loadState();
  renderGoals();
  renderLinks();
  setInterval(tickCountdowns, 1000);
}

init();
