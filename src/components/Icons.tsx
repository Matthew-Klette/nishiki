const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const ArrowDown = () => (
  <svg {...base}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);

export const ArrowRight = () => (
  <svg {...base}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const ArrowLeft = () => (
  <svg {...base}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const Pause = () => (
  <svg {...base}>
    <path d="M9 6v12M15 6v12" />
  </svg>
);

export const Play = () => (
  <svg {...base}>
    <path d="M8 5.5v13l10-6.5z" />
  </svg>
);
