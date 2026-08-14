// Route links should start at the top; browser history should return visitors to where they left.
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

type ScrollBehavior = "auto" | "smooth";
type ScrollPosition = { x: number; y: number };

const SCROLL_STATE_KEY = "__willersScrollPosition";

function getHistoryState() {
  const state = window.history.state;
  return state && typeof state === "object" ? state as Record<string, unknown> : {};
}

function getSavedPosition(): ScrollPosition | null {
  const position = getHistoryState()[SCROLL_STATE_KEY];
  if (!position || typeof position !== "object") return null;
  const { x, y } = position as Partial<ScrollPosition>;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function saveScrollPosition() {
  window.history.replaceState({ ...getHistoryState(), [SCROLL_STATE_KEY]: { x: window.scrollX, y: window.scrollY } }, "", window.location.href);
}

function scrollToHash(behavior: ScrollBehavior) {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const target = document.getElementById(decodeURIComponent(hash));
  if (!target) return false;
  target.scrollIntoView({ behavior, block: "start" });
  return true;
}

export default function ScrollManager() {
  const [location] = useLocation();
  const hasMounted = useRef(false);
  const historyNavigation = useRef(false);
  const linkNavigation = useRef(false);
  const scrollFrame = useRef<number | null>(null);

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    saveScrollPosition();
    const scheduleSave = () => {
      if (scrollFrame.current !== null) return;
      scrollFrame.current = window.requestAnimationFrame(() => {
        scrollFrame.current = null;
        saveScrollPosition();
      });
    };
    const markHistoryNavigation = () => { historyNavigation.current = true; };
    const saveBeforeNavigation = () => saveScrollPosition();
    window.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener("pagehide", saveScrollPosition);
    window.addEventListener("popstate", markHistoryNavigation);
    document.addEventListener("click", saveBeforeNavigation, true);
    return () => {
      if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
      window.removeEventListener("scroll", scheduleSave);
      window.removeEventListener("pagehide", saveScrollPosition);
      window.removeEventListener("popstate", markHistoryNavigation);
      document.removeEventListener("click", saveBeforeNavigation, true);
      if ("scrollRestoration" in window.history) window.history.scrollRestoration = "auto";
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!hasMounted.current) {
        hasMounted.current = true;
        if (!scrollToHash("auto")) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }
      if (historyNavigation.current) {
        historyNavigation.current = false;
        const saved = getSavedPosition();
        if (saved) window.scrollTo({ top: saved.y, left: saved.x, behavior: "auto" });
        else if (!scrollToHash("auto")) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }
      if (linkNavigation.current) linkNavigation.current = false;
      if (!scrollToHash("auto")) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location]);

  useEffect(() => {
    const handleAnchorClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const destination = new URL(anchor.href, window.location.href);
      const isInternal = destination.origin === window.location.origin;
      const sameDocument = isInternal && destination.pathname === window.location.pathname && destination.search === window.location.search;
      if (sameDocument && destination.hash) {
        const hashTarget = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
        if (!hashTarget) return;
        event.preventDefault();
        saveScrollPosition();
        const targetTop = Math.max(0, Math.round(hashTarget.getBoundingClientRect().top + window.scrollY));
        window.history.pushState({ ...getHistoryState(), [SCROLL_STATE_KEY]: { x: 0, y: targetTop } }, "", destination.href);
        hashTarget.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (isInternal && (destination.pathname !== window.location.pathname || destination.search !== window.location.search)) linkNavigation.current = true;
    };
    document.addEventListener("click", handleAnchorClick);
    return () => document.removeEventListener("click", handleAnchorClick);
  }, []);

  return null;
}
