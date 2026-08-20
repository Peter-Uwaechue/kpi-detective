import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import BackToTop from "./components/BackToTop";
import ScrollManager from "./components/ScrollManager";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Route, Switch } from "wouter";
import KPIDetective from "./pages/KPIDetective";
import LogtoCallback from "./pages/LogtoCallback";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <ScrollManager />
          <BackToTop />
          <Switch>
            <Route path="/auth/logto/callback" component={LogtoCallback} />
            <Route path="/kpi-detective" component={KPIDetective} />
            <Route path="/" component={KPIDetective} />
            <Route component={KPIDetective} />
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
