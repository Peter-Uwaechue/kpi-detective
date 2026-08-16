import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { getRouteMeta } from "@shared/seo";

export function Head() {
  const [location] = useLocation();
  const search = useSearch();

  useEffect(() => {
    document.title = getRouteMeta(`${location}${search ? `?${search}` : ""}`).title;
  }, [location, search]);

  return null;
}
