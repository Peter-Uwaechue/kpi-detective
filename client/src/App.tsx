import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import BackToTop from "./components/BackToTop";
import ScrollManager from "./components/ScrollManager";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Route, Switch } from "wouter";
import Home from "./pages/Home";

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <ScrollManager />
          <BackToTop />
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/leadership/hannah-uwaechue" component={Home} />
            <Route path="/leadership/remi-abubakar-bello" component={Home} />
            <Route path="/services/:slug" component={Home} />
            <Route path="/:rest*" component={Home} />
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
