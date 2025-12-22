export const fadeInStyle = (index) => ({
  opacity: 0,
  animationName: "fadeIn",
  animationDuration: "0.4s",
  animationTimingFunction: "ease",
  animationFillMode: "forwards",
  animationDelay: `${index * 40}ms`,
});
