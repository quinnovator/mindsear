import { useEffect, type ReactNode } from 'react';
import { matchPath, useLocation } from './router.tsx';
import { GlobalErrorBanner, SimpleHeader } from './ui.tsx';
import { Link } from './router.tsx';
import { Root, ObjectivesList } from './pages/Objectives.tsx';
import { Intake } from './pages/Intake.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { PlanReview } from './pages/PlanReview.tsx';
import { EnrollmentIndex, HomePage } from './pages/Home.tsx';
import { ProgressMap } from './pages/ProgressMap.tsx';
import { ReadinessPage } from './pages/Readiness.tsx';
import { Session } from './pages/Session.tsx';

type Route = { pattern: string; title: string; render: (p: Record<string, string>) => ReactNode };

const ROUTES: Route[] = [
  { pattern: '/', title: 'Mind Sear', render: () => <Root /> },
  { pattern: '/objectives', title: 'Your objectives', render: () => <ObjectivesList /> },
  { pattern: '/new', title: 'What do you want to learn?', render: () => <Intake key="intake" objectiveId={null} /> },
  {
    pattern: '/objectives/:id',
    title: 'Setting up your plan',
    render: (p) => <Intake key="intake" objectiveId={p.id} />,
  },
  { pattern: '/library/:packId', title: 'Choose your goal', render: (p) => <Onboarding packId={p.packId} /> },
  { pattern: '/plans/:id', title: 'Review your plan', render: (p) => <PlanReview planId={p.id} /> },
  { pattern: '/e/:id', title: 'Home', render: (p) => <EnrollmentIndex key={p.id} enrollmentId={p.id} /> },
  { pattern: '/e/:id/home', title: 'Home', render: (p) => <HomePage key={p.id} enrollmentId={p.id} /> },
  { pattern: '/e/:id/map', title: 'Your map', render: (p) => <ProgressMap key={p.id} enrollmentId={p.id} /> },
  { pattern: '/e/:id/readiness', title: 'Readiness', render: (p) => <ReadinessPage key={p.id} enrollmentId={p.id} /> },
  { pattern: '/s/:id', title: 'Session', render: (p) => <Session key={p.id} sessionId={p.id} /> },
];

function NotFound() {
  return (
    <div className="screen">
      <SimpleHeader />
      <main className="page page-narrow">
        <h1 className="h1">This page doesn't exist</h1>
        <p className="lede">
          The link may be old. <Link to="/objectives">Go to your objectives</Link>
        </p>
      </main>
    </div>
  );
}

export function App() {
  const { path } = useLocation();
  let content: ReactNode = <NotFound />;
  let title = 'Not found';
  for (const r of ROUTES) {
    const params = matchPath(r.pattern, path);
    if (params) {
      content = r.render(params);
      title = r.title;
      break;
    }
  }
  useEffect(() => {
    document.title = title === 'Mind Sear' ? title : `${title} · Mind Sear`;
  }, [title]);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <GlobalErrorBanner />
      {content}
    </>
  );
}
