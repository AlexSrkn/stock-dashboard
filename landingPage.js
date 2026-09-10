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

function prepareConstellationPaths(constellation) {
  constellation.querySelectorAll(".landing-constellation__path").forEach((path) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
  });
}

function initLandingConstellation(root) {
  const constellation = root.querySelector(".landing-constellation");
  if (!constellation) return;

  prepareConstellationPaths(constellation);

  const draw = () => {
    if (prefersReducedMotion()) {
      constellation.classList.add("is-drawn", "is-flowing");
      constellation.querySelectorAll(".landing-constellation__path").forEach((path) => {
        path.style.strokeDashoffset = "0";
      });
      return;
    }
    constellation.classList.add("is-drawn");
    window.setTimeout(() => constellation.classList.add("is-flowing"), 1100);
  };

  if (!("IntersectionObserver" in window)) {
    draw();
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          draw();
          io.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    io.observe(constellation);
  }

  const clearActive = () => {
    constellation.classList.remove(
      "is-active-stocks",
      "is-active-institutions",
      "is-active-insiders",
      "is-active-congress",
      "is-active-sector",
      "is-active-hub"
    );
  };

  constellation.querySelectorAll(".landing-node").forEach((node) => {
    const mode = node.getAttribute("data-landing-enter");
    const activeClass =
      mode === "stocks"
        ? "is-active-stocks"
        : mode === "institutions"
          ? "is-active-institutions"
          : mode === "insiders"
            ? "is-active-insiders"
            : mode === "politicians"
              ? "is-active-congress"
              : mode === "sector"
                ? "is-active-sector"
                : mode === "signals"
                  ? "is-active-hub"
                  : null;

    if (!activeClass) return;

    node.addEventListener("mouseenter", () => {
      clearActive();
      constellation.classList.add(activeClass);
    });
    node.addEventListener("focus", () => {
      clearActive();
      constellation.classList.add(activeClass);
    });
    node.addEventListener("mouseleave", clearActive);
    node.addEventListener("blur", clearActive);
  });
}

export function initLandingPage() {
  const root = document.getElementById("view-landing");
  if (!root) return;
  let started = false;
  const start = () => {
    if (started || root.hidden) return;
    started = true;
    initLandingReveal(root);
    initLandingConstellation(root);
  };
  start();
  const mo = new MutationObserver(start);
  mo.observe(root, { attributes: true, attributeFilter: ["hidden"] });
}
