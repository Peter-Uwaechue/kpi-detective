import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

const SCROLL_THRESHOLD = 520;

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > SCROLL_THRESHOLD);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  const returnToTop = () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  return <button type="button" className={`back-to-top ${visible ? "is-visible" : ""}`} onClick={returnToTop} aria-label="Back to top" title="Back to top"><ArrowUp size={19} aria-hidden="true" /></button>;
}
