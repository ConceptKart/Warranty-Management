import { createElement, Fragment } from "react";

export function PortalShell({ children }) {
  return createElement(Fragment, null, children);
}
