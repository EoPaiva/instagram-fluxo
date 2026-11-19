/* Read-only queue presentation. Relationship actions remain in the existing workflow. */
(() => {
  "use strict";

  const root = document.getElementById("follow-queue");
  if (!root) return;
  const get = (id) => document.getElementById(id);
  const stage = get("queue-stage");
  const previousButton = get("queue-previous");
  const nextButton = get("queue-next");
  const currentButton = get("queue-current");
  const countdown = get("queue-countdown");
  const cards = new Map();
  const failedAvatars = new Set();
  const animations = new Set();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const terminal = new Set(["following", "requested", "skipped", "uncertain"]);
  const states = {
    idle: "Pronta para começar", discovering: "Buscando sugestões", running: "Fila em andamento",
    waiting: "Respeitando o intervalo", dispatching: "Conferindo a ação", paused: "Fila pausada",
    blocked: "Pausada por bloqueio", completed: "Fila concluída", error: "A fila precisa de atenção",
    interrupted: "Execução interrompida"
  };
  const itemStates = {
    pending: ["Sugestão na fila", "Sugestão observada. Aguardando sua vez na sequência."],
    waiting: ["Aguardando o intervalo", "O intervalo continua. Nenhuma ação foi enviada."],
    dispatching: ["Conferindo no Instagram", "Aguardando a confirmação dos controles do Instagram."],
    following: ["Seguido pelo fluxo", "A ação de seguir foi confirmada no Instagram."],
    requested: ["Solicitação enviada", "O Instagram confirmou o estado Solicitado."],
    skipped: ["Perfil pulado", "Este perfil não recebeu uma nova ação."],
    uncertain: ["Resultado não confirmado", "O resultado precisa de verificação no Instagram."]
  };
  const defaults = {
    idle: "Carregue seu perfil, configure as referências e inicie uma fila.",
    discovering: "As sugestões encontradas aparecerão aqui, na ordem da fila.",
    running: "Acompanhe o perfil atual e os próximos da sequência.",
    waiting: "A fila aguarda o intervalo antes da próxima tentativa.",
    dispatching: "A ação só entra no progresso depois da confirmação do Instagram.",
    paused: "A fila está pausada. Use os controles do fluxo para retomar.",
    blocked: "Resolva a restrição no Instagram e retome pelo controle de desbloqueio.",
    completed: "Confira os resultados da sequência usando as setas.",
    error: "Confira a mensagem da execução antes de retomar a fila.",
    interrupted: "O trabalho salvo continua disponível nos controles do fluxo."
  };
  let model = null;
  let identity = null;
  let inspectedUsername = null;
  let displayedUsername = null;
  let lastAnnouncement = "";
  let timer = null;
  let inViewport = !globalThis.IntersectionObserver;

  const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const attribute = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
  const property = (node, name, value) => { if (node[name] !== value) node[name] = value; };
  const username = (value) => {
    const name = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
    return /^[a-z0-9._]{1,30}$/i.test(name) && /[a-z0-9_]/i.test(name) ? name.toLowerCase() : null;
  };
  const avatarUrl = (value) => {
    if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return "";
    try {
      const url = new URL(value);
      const allowed = ["cdninstagram.com", "fbcdn.net"].some(host => url.hostname === host || url.hostname.endsWith("." + host));
      return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed && url.href.length <= 2048 ? url.href : "";
    } catch { return ""; }
  };
  const localPhoto = (value) => typeof value === "string" && value.length <= 32768 &&
    /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value) &&
    (value.length - "data:image/jpeg;base64,".length) % 4 === 0 ? value : "";
  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const motionAllowed = () => !document.hidden && inViewport && !reducedMotion.matches && document.documentElement.dataset.brandPaused !== "true";
  const isWaiting = () => model && model.phase === "waiting" && ["waiting", "running"].includes(model.status) && model.nextAt !== null;

  function cancelAnimations() {
    for (const animation of animations) animation.cancel();
    animations.clear();
  }

  function animateCard(node, before, duration) {
    if (!motionAllowed() || typeof node.animate !== "function") return;
    const after = getComputedStyle(node);
    const destination = { transform: after.transform, opacity: after.opacity };
    const origin = before || { transform: destination.transform, opacity: 0 };
    if (origin.transform === destination.transform && origin.opacity === destination.opacity) return;
    const animation = node.animate([origin, destination], {
      duration, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "none"
    });
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  }

  function normalize(input = {}) {
    if (!input || typeof input !== "object") input = {};
    const current = username(input.currentUsername);
    const seen = new Set();
    const items = [];
    for (const item of Array.isArray(input.items) ? input.items : []) {
      const name = username(item?.username);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      items.push({ username: name, label: typeof item.label === "string" ? item.label.slice(0, 100) : "",
        avatarUrl: avatarUrl(item.avatarUrl), status: Object.hasOwn(itemStates, item.status) ? item.status : "pending",
        fromFollowers: item.fromFollowers === true, reference: username(item.reference) });
      if (items.length === 10000) break;
    }
    if (current && !seen.has(current)) {
      const activePhase = ["running", "waiting", "dispatching"].includes(input.status) && ["waiting", "dispatching"].includes(input.phase);
      items.unshift({ username: current, label: "", avatarUrl: "", status: activePhase ? input.phase : "pending", reference: null });
      items.length = Math.min(items.length, 10000);
    }
    return {
      owner: username(input.owner), runId: typeof input.runId === "string" ? input.runId.slice(0, 160) : null,
      status: Object.hasOwn(states, input.status) ? input.status : "idle",
      phase: ["waiting", "dispatching"].includes(input.phase) ? input.phase : "idle", currentUsername: current,
      target: count(input.target), followed: count(input.followed), requested: count(input.requested), items,
      nextAt: typeof input.nextAt === "number" && Number.isFinite(input.nextAt) && input.nextAt > 0 ? input.nextAt : null,
      message: typeof input.message === "string" ? input.message.slice(0, 800) : "", aiMode: input.aiMode === true,
      followerFallback: input.followerFallback === true
    };
  }

  function currentIndex() {
    const explicit = model.items.findIndex((item) => item.username === model.currentUsername);
    if (explicit >= 0) return explicit;
    if (model.status === "completed") return Math.max(0, model.items.length - 1);
    const pending = model.items.findIndex((item) => !terminal.has(item.status));
    return pending >= 0 ? pending : Math.max(0, model.items.length - 1);
  }

  function selectedIndex() {
    const inspected = model.items.findIndex((item) => item.username === inspectedUsername);
    return inspected >= 0 ? inspected : currentIndex();
  }

  function createCard(item) {
    const node = document.createElement("article");
    node.className = "queue-profile";
    node.dataset.username = item.username;
    const position = document.createElement("p");
    position.className = "queue-profile-position";
    const avatar = document.createElement("span");
    avatar.className = "queue-monogram";
    avatar.setAttribute("aria-hidden", "true");
    avatar.dataset.avatarState = "none";
    const initials = document.createElement("span");
    initials.className = "queue-avatar-initials";
    text(initials, item.username.replace(/[._]/g, "").slice(0, 2).toUpperCase() || item.username.slice(0, 2));
    const image = document.createElement("img");
    image.className = "queue-avatar-image";
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.width = 57;
    image.height = 57;
    avatar.append(initials, image);
    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.className = "queue-profile-handle";
    link.href = `https://www.instagram.com/${encodeURIComponent(item.username)}/`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `Abrir @${item.username} no Instagram em nova aba`);
    text(link, `@${item.username}`);
    heading.append(link);
    const label = document.createElement("p");
    label.className = "queue-profile-label";
    const status = document.createElement("p");
    status.className = "queue-profile-status";
    const description = document.createElement("p");
    description.className = "queue-profile-description";
    const reference = document.createElement("p");
    reference.className = "queue-profile-reference";
    node.append(position, avatar, heading, label, status, description, reference);
    node.queueParts = { position, avatar, image, link, label, status, description, reference };
    return node;
  }

  function updateAvatar(node, item, slot) {
    if (Math.abs(slot) > 1) return;
    const { avatar, image } = node.queueParts;
    const source = avatarUrl(item.avatarUrl);
    const owner = model.owner || "";
    const key = `${owner}|${item.username}|${source}`;
    if (node.queueAvatarKey === key) return;
    node.queueAvatarKey = key;
    const generation = (node.queueAvatarGeneration || 0) + 1;
    node.queueAvatarGeneration = generation;
    image.onload = null;
    image.onerror = null;
    if (image.hasAttribute("src")) image.removeAttribute("src");
    if (!owner || !source || failedAvatars.has(key)) {
      attribute(avatar, "data-avatar-state", owner && source ? "error" : "none");
      return;
    }
    const stillCurrent = () => node.queueAvatarKey === key && node.queueAvatarGeneration === generation &&
      cards.get(item.username) === node && model?.owner === owner;
    const unavailable = (status = "error") => {
      if (!stillCurrent()) return;
      failedAvatars.add(key);
      attribute(avatar, "data-avatar-state", status);
    };
    attribute(avatar, "data-avatar-state", "loading");
    Promise.resolve().then(() => globalThis.instagramProfilePhotos?.load(owner, item.username, source) || { status: "unavailable" })
      .then(result => {
        if (!stillCurrent()) return;
        const dataUrl = result?.status === "ready" ? localPhoto(result.dataUrl) : "";
        if (!dataUrl) {
          unavailable(result?.status === "permission-required" ? "permission-required" : "error");
          return;
        }
        const loaded = () => {
          if (stillCurrent() && image.getAttribute("src") === dataUrl && image.complete && image.naturalWidth > 0) {
            attribute(avatar, "data-avatar-state", "loaded");
          }
        };
        image.onload = loaded;
        image.onerror = () => { if (image.getAttribute("src") === dataUrl) unavailable(); };
        // Only the worker's bounded local JPEG reaches the native image element.
        attribute(image, "src", dataUrl);
        loaded();
      }).catch(() => unavailable());
  }

  function updateCard(node, item, slot) {
    const parts = node.queueParts;
    updateAvatar(node, item, slot);
    const actual = item.username === model.currentUsername;
    let state = item.status;
    if (actual && !terminal.has(state) && ["running", "waiting", "dispatching"].includes(model.status) && ["waiting", "dispatching"].includes(model.phase)) state = model.phase;
    let [label, description] = itemStates[state];
    if (state === "pending" && item.fromFollowers) {
      label = "Seguidor da referência na fila";
      description = "Perfil observado entre os seguidores da referência. Aguardando sua vez.";
    }
    if (state === "pending" && model.aiMode) description = "Perfil observado. A seleção da IA ainda pode descartá-lo.";
    if (actual && !terminal.has(state) && ["paused", "blocked", "error", "interrupted"].includes(model.status)) {
      label = states[model.status];
      description = defaults[model.status];
    }
    text(parts.position, slot < 0 ? "Anterior" : slot > 0 ? "A seguir" : actual ? "Perfil atual" : model.status === "completed" ? "Resultado da fila" : "Na sequência");
    text(parts.label, item.label && item.label.toLowerCase() !== item.username ? item.label : "");
    property(parts.label, "hidden", !parts.label.textContent);
    text(parts.status, label);
    text(parts.description, description);
    text(parts.reference, item.reference ? `Referência @${item.reference}` : "");
    property(parts.reference, "hidden", !item.reference);
    attribute(node, "data-slot", slot);
    attribute(node, "data-status", state);
    attribute(node, "aria-hidden", slot !== 0);
    property(parts.link, "tabIndex", slot === 0 ? 0 : -1);
  }

  function paintCards(duration) {
    const index = selectedIndex();
    const item = model.items[index];
    const nextUsername = item?.username || null;
    const moving = displayedUsername !== null && nextUsername !== displayedUsername;
    const before = new Map();
    if (moving && motionAllowed()) {
      for (const [key, node] of cards) {
        const style = getComputedStyle(node);
        before.set(key, { transform: style.transform, opacity: style.opacity });
      }
    }
    if (moving) cancelAnimations();
    const wanted = new Set();
    for (let offset = -2; offset <= 2; offset++) {
      const entry = model.items[index + offset];
      if (!entry) continue;
      wanted.add(entry.username);
      let node = cards.get(entry.username);
      if (!node) {
        node = createCard(entry);
        cards.set(entry.username, node);
        stage.append(node);
      }
      updateCard(node, entry, offset);
    }
    for (const [key, node] of cards) {
      if (wanted.has(key)) continue;
      if (node.contains(document.activeElement)) stage.focus({ preventScroll: true });
      node.remove();
      cards.delete(key);
    }
    if (moving) {
      for (const [key, node] of cards) animateCard(node, before.get(key), duration);
    }
    displayedUsername = nextUsername;
    property(stage, "hidden", !item);
    property(get("queue-empty"), "hidden", Boolean(item));
    property(get("queue-neighbors"), "hidden", !item);
    text(get("queue-previous-name"), model.items[index - 1] ? `@${model.items[index - 1].username}` : "Início da fila");
    text(get("queue-next-name"), model.items[index + 1] ? `@${model.items[index + 1].username}` : "Fim da fila");
    property(previousButton, "disabled", !item || index === 0);
    property(nextButton, "disabled", !item || index === model.items.length - 1);
    const following = inspectedUsername === null;
    attribute(root, "data-following-current", following);
    property(currentButton, "disabled", !item || inspectedUsername === null);
    text(currentButton, inspectedUsername === null ? "Acompanhando a fila" : model.currentUsername ? "Voltar ao perfil atual" : "Voltar à fila");
    text(get("queue-position"), item ? `Perfil ${index + 1} de ${model.items.length}` : "Nenhum perfil na fila");
    text(get("queue-empty-title"), model.status === "discovering" ? "Buscando as próximas sugestões" : ["blocked", "error", "paused", "interrupted"].includes(model.status) ? states[model.status] : model.status === "completed" ? "Esta sequência foi concluída" : "Sua próxima sequência começa aqui");
    fitStage();
  }

  function fitStage() {
    if (stage.hidden) return;
    const height = Math.max(0, ...Array.from(cards.values(), (node) => node.offsetHeight)) + 24;
    if (stage.style.height !== `${height}px`) stage.style.height = `${height}px`;
  }

  function updateCountdown() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    property(countdown, "hidden", !isWaiting());
    if (!isWaiting() || document.hidden || !inViewport) return;
    const seconds = Math.max(0, Math.ceil((model.nextAt - Date.now()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const formatted = hours ? `${hours}h ${String(minutes).padStart(2, "0")}min ${String(seconds % 60).padStart(2, "0")}s` : `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    text(countdown, seconds > 0 ? `Próxima tentativa em ${formatted}` : "Intervalo concluído · aguardando a fila");
    if (seconds > 0) timer = setTimeout(updateCountdown, 1000 - (Date.now() % 1000) + 20);
  }

  function announce() {
    const selected = model.items[selectedIndex()];
    const key = [model.owner, model.runId, model.status, model.currentUsername, model.followed, model.requested, inspectedUsername].join("|");
    if (key === lastAnnouncement) return;
    lastAnnouncement = key;
    const progress = model.target ? `${model.followed + model.requested} de ${model.target} ações confirmadas.` : "";
    text(get("queue-announcement"), inspectedUsername && selected ? `Consultando @${selected.username}. A execução continua no perfil atual.` : `${states[model.status]}.${model.currentUsername ? ` Perfil atual: @${model.currentUsername}.` : ""} ${progress}`);
  }

  function browse(delta, absolute = false) {
    if (!model?.items.length) return;
    const index = Math.min(model.items.length - 1, Math.max(0, absolute ? delta : selectedIndex() + delta));
    inspectedUsername = model.items[index].username;
    paintCards(260);
    announce();
  }

  function render(input) {
    const nextModel = normalize(input);
    const nextIdentity = `${nextModel.owner || ""}|${nextModel.runId || ""}`;
    if (identity !== nextIdentity) {
      cancelAnimations();
      inspectedUsername = null;
      displayedUsername = null;
      identity = nextIdentity;
    } else if (model?.currentUsername !== nextModel.currentUsername && stage.contains(document.activeElement)) {
      inspectedUsername = document.activeElement.closest("[data-username]")?.dataset.username || displayedUsername;
    }
    model = nextModel;
    if (!model.items.some((item) => item.username === inspectedUsername)) inspectedUsername = null;
    attribute(root, "data-state", model.status);
    text(get("queue-state"), states[model.status]);
    text(get("queue-owner"), model.owner ? `@${model.owner} · ${model.aiMode ? "Com agente de IA" : model.followerFallback ? "Sugestões e seguidores" : "Sugestões diretas"}` : "Nenhuma conta carregada");
    text(get("queue-message"), model.message || defaults[model.status]);
    const confirmed = model.followed + model.requested;
    const progress = get("queue-progress");
    attribute(progress, "max", Math.max(1, model.target));
    attribute(progress, "value", confirmed);
    property(get("queue-meter"), "hidden", !model.target && !confirmed);
    text(get("queue-progress-label"), model.target ? `${confirmed} de ${model.target} ações confirmadas` : `${confirmed} ações confirmadas`);
    text(get("queue-results"), `${model.followed} seguidos · ${model.requested} solicitações`);
    paintCards(420);
    updateCountdown();
    announce();
  }

  previousButton.addEventListener("click", () => browse(-1));
  document.addEventListener("instagram-fluxo-photos-ready", () => {
    failedAvatars.clear();
    for (const node of cards.values()) {
      if (node.queueParts.avatar.dataset.avatarState === "loaded") continue;
      node.queueAvatarKey = null;
      node.queueAvatarGeneration = (node.queueAvatarGeneration || 0) + 1;
    }
    if (model) paintCards(0);
  });
  nextButton.addEventListener("click", () => browse(1));
  currentButton.addEventListener("click", () => {
    inspectedUsername = null;
    paintCards(360);
    announce();
  });
  root.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || ![stage, previousButton, nextButton, currentButton].includes(event.target)) return;
    if (event.key === "ArrowLeft") browse(-1);
    else if (event.key === "ArrowRight") browse(1);
    else if (event.key === "Home") browse(0, true);
    else if (event.key === "End") browse(model?.items.length - 1, true);
    else return;
    event.preventDefault();
  });
  const visibilityChanged = () => {
    if (!motionAllowed()) cancelAnimations();
    updateCountdown();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  reducedMotion.addEventListener("change", visibilityChanged);
  new MutationObserver(visibilityChanged).observe(document.documentElement, { attributes: true, attributeFilter: ["data-brand-paused"] });
  if (globalThis.IntersectionObserver) {
    new IntersectionObserver(([entry]) => { inViewport = entry.isIntersecting; visibilityChanged(); }, { threshold: 0 }).observe(root);
  }
  if (globalThis.ResizeObserver) {
    let lastWidth = 0;
    new ResizeObserver(([entry]) => {
      if (lastWidth === entry.contentRect.width) return;
      lastWidth = entry.contentRect.width;
      fitStage();
    }).observe(stage);
  }
  document.fonts?.ready.then(fitStage);
  globalThis.instagramQueueView = Object.freeze({ render });
  render({});
})();
