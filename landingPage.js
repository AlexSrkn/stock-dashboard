const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion() {
  return REDUCE_MOTION.matches;
}

function initLandingReveal(root) {
  const nodes = [...root.querySelectorAll(".landing-reveal")];
  if (!nodes.length) return;
  if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
    nodes.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );
  nodes.forEach((el) => io.observe(el));
}

function initLandingDemo(root) {
  const tabs = [...root.querySelectorAll(".landing-demo__tab")];
  const panels = [...root.querySelectorAll(".landing-demo__panel")];
  if (!tabs.length || !panels.length) return;

  const ids = tabs.map((t) => t.getAttribute("data-landing-demo")).filter(Boolean);
  let i = 0;

  const activate = (id) => {
    tabs.forEach((tab) => {
      const on = tab.getAttribute("data-landing-demo") === id;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== id;
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      i = index;
      activate(tab.getAttribute("data-landing-demo"));
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
      i = next;
      tabs[next].focus();
      activate(tabs[next].getAttribute("data-landing-demo"));
    });
  });

  let timer = null;
  const play = () => {
    if (prefersReducedMotion() || ids.length < 2) return;
    timer = window.setInterval(() => {
      i = (i + 1) % ids.length;
      activate(ids[i]);
    }, 5200);
  };
  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  };

  const stage = root.querySelector(".landing-demo");
  stage?.addEventListener("mouseenter", stop);
  stage?.addEventListener("focusin", stop);
  stage?.addEventListener("mouseleave", play);
  REDUCE_MOTION.addEventListener?.("change", () => {
    stop();
    play();
  });
  play();
}

export function initLandingPage() {
  const root = document.getElementById("view-landing");
  if (!root) return;
  let started = false;
  const start = () => {
    if (started || root.hidden) return;
    started = true;
    initLandingReveal(root);
    initLandingDemo(root);
  };
  start();
  const mo = new MutationObserver(start);
  mo.observe(root, { attributes: true, attributeFilter: ["hidden"] });
}
