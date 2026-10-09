"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function AdminNavbar({
  name,
  role,
  canManageUsers,
  canManageShipments,
  canViewShipmentInfo,
}: {
  name: string;
  role: string;
  canManageUsers: boolean;
  canManageShipments: boolean;
  canViewShipmentInfo: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userMenuRef = useRef<HTMLLIElement>(null);

  const dashActive = pathname === "/admin";
  const ticketsActive = pathname.startsWith("/admin/tickets");
  const shipmentsActive = pathname.startsWith("/admin/shipments");
  const trackingActive = pathname.startsWith("/admin/tracking");
  const shipwayLookupActive = pathname.startsWith("/admin/shipway-tracker");
  const amazonActive = pathname.startsWith("/admin/amazon-orders");
  const usersActive = pathname.startsWith("/admin/users");

  useEffect(() => {
    setNavOpen(false);
    setUserOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(e.target as Node)
      ) {
        setUserOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      router.replace("/admin/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  function closeNav() {
    setNavOpen(false);
    setUserOpen(false);
  }

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-primary sticky-top">
      <div className="container-fluid">
        <Link className="navbar-brand" href="/admin" onClick={closeNav}>
          <span className="d-none d-sm-inline">Warranty Admin</span>
          <span className="d-inline d-sm-none">Admin</span>
        </Link>
        <button
          className="navbar-toggler"
          type="button"
          aria-controls="navbarNav"
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
          onClick={() => {
            setNavOpen((open) => !open);
            setUserOpen(false);
          }}
        >
          <span className="navbar-toggler-icon" />
        </button>
        <div
          className={`collapse navbar-collapse${navOpen ? " show" : ""}`}
          id="navbarNav"
        >
          <ul className="navbar-nav me-auto">
            <li className="nav-item">
              <Link
                className={`nav-link${dashActive ? " active" : ""}`}
                href="/admin"
                onClick={closeNav}
              >
                Dashboard
              </Link>
            </li>
            <li className="nav-item">
              <Link
                className={`nav-link${ticketsActive ? " active" : ""}`}
                href="/admin/tickets"
                onClick={closeNav}
              >
                Tickets
              </Link>
            </li>
            {canManageShipments ? (
              <li className="nav-item">
                <Link
                  className={`nav-link${shipmentsActive ? " active" : ""}`}
                  href="/admin/shipments"
                  onClick={closeNav}
                >
                  Shipments
                </Link>
              </li>
            ) : null}
            {canViewShipmentInfo ? (
              <>
                <li className="nav-item">
                  <Link
                    className={`nav-link${trackingActive ? " active" : ""}`}
                    href="/admin/tracking"
                    onClick={closeNav}
                  >
                    Tracking
                  </Link>
                </li>
                <li className="nav-item">
                  <Link
                    className={`nav-link${shipwayLookupActive ? " active" : ""}`}
                    href="/admin/shipway-tracker"
                    onClick={closeNav}
                  >
                    Lookup
                  </Link>
                </li>
              </>
            ) : null}
            <li className="nav-item">
              <Link
                className={`nav-link${amazonActive ? " active" : ""}`}
                href="/admin/amazon-orders"
                onClick={closeNav}
              >
                Amazon
              </Link>
            </li>
            {canManageUsers ? (
              <li className="nav-item">
                <Link
                  className={`nav-link${usersActive ? " active" : ""}`}
                  href="/admin/users"
                  onClick={closeNav}
                >
                  Users
                </Link>
              </li>
            ) : null}
          </ul>
          <ul className="navbar-nav">
            <li className="nav-item dropdown" ref={userMenuRef}>
              <button
                type="button"
                className="nav-link dropdown-toggle btn btn-link text-white text-decoration-none"
                aria-expanded={userOpen}
                onClick={() => setUserOpen((open) => !open)}
              >
                <span
                  className="d-inline-block text-truncate align-middle"
                  style={{ maxWidth: 140 }}
                >
                  {name}
                </span>
                <span className="badge bg-secondary ms-1">
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </span>
              </button>
              <ul
                className={`dropdown-menu dropdown-menu-end${userOpen ? " show" : ""}`}
              >
                {canManageUsers ? (
                  <>
                    <li>
                      <Link
                        className="dropdown-item"
                        href="/admin/users"
                        onClick={closeNav}
                      >
                        Manage Users
                      </Link>
                    </li>
                    <li>
                      <hr className="dropdown-divider" />
                    </li>
                  </>
                ) : null}
                <li>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={logout}
                    disabled={loggingOut}
                  >
                    {loggingOut ? "Logging out…" : "Logout"}
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}
