import Image from "next/image";

const steps = [
  { id: "input", label: "Order", labelFull: "Order Details" },
  { id: "issue", label: "Issue", labelFull: "Issue Selection" },
  { id: "fix", label: "Fix", labelFull: "Troubleshooting" },
  { id: "done", label: "Done", labelFull: "Resolution" },
] as const;

export function PortalShell({
  activeStep,
  children,
}: {
  activeStep: "input" | "issue" | "fix" | "done" | "track" | "resolved";
  children: React.ReactNode;
}) {
  const order: Array<(typeof steps)[number]["id"]> = [
    "input",
    "issue",
    "fix",
    "done",
  ];

  function stepClass(id: (typeof steps)[number]["id"]) {
    // Track keeps progress visible but no step active (matches PHP track view)
    if (activeStep === "track") return "";
    if (activeStep === "resolved") {
      return "completed";
    }
    const activeIdx = order.indexOf(
      activeStep === "done" ? "done" : activeStep,
    );
    const idx = order.indexOf(id);
    if (idx === activeIdx) return "active";
    if (idx < activeIdx) return "completed";
    return "";
  }

  return (
    <div className="container-fluid px-3 px-md-4">
      <div className="row justify-content-center">
        <div className="col-12 col-lg-10 col-xl-8">
          <header className="header text-center py-4">
            <div className="logo-container mb-3">
              <a
                href="https://conceptkart.com"
                target="_blank"
                rel="noreferrer"
                style={{ display: "inline-block" }}
              >
                <Image
                  src="/images/conceptkart-logo.png"
                  alt="ConceptKart Logo"
                  width={338}
                  height={80}
                  className="img-fluid logo-responsive"
                  priority
                  style={{ width: 338, height: "auto", cursor: "pointer" }}
                />
              </a>
            </div>
            <h1 className="h2 h1-md mb-3">Warranty/Replacement Portal</h1>
            <p className="lead text-muted">
              Submit and track your warranty/replacement requests
            </p>
          </header>

          <div className="progress-bar-container mb-4">
            <div className="row g-2 g-md-3">
              {steps.map((step) => (
                <div key={step.id} className="col-3">
                  <div className={`step ${stepClass(step.id)}`}>
                    <span className="step-number">
                      {order.indexOf(step.id) + 1}
                    </span>
                    <span className="step-label d-none d-sm-block">
                      {step.labelFull}
                    </span>
                    <span className="step-label d-sm-none">{step.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <main className="main-content">{children}</main>
        </div>
      </div>
    </div>
  );
}
