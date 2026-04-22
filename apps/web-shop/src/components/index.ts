/**
 * FROZEN API for Phase 3 subagents. Add nothing else to this file.
 * Subagents compose pages from ONLY these exports; they may NOT
 * import anything else from the library (e.g. cva variants internals).
 */

// UI primitives
export { Button } from './ui/button';
export { Input, InputAddon, InputGroup } from './ui/input';
export { Label } from './ui/label';
export { Card, CardHeader, CardBody, CardFooter, CardTitle } from './ui/card';
export { Badge } from './ui/badge';
export { Skeleton } from './ui/skeleton';
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
export { Stepper, type StepperStep } from './ui/Stepper';

// Layout
export { Container } from './layout/Container';
export { Stack } from './layout/Stack';
export { Row } from './layout/Row';
export { Section } from './layout/Section';
export { StickyBottomBar, StickyBottomBarSpacer } from './layout/StickyBottomBar';
export { SectionHeader } from './layout/SectionHeader';

// Shop composites
export { TrustStrip } from './shop/TrustStrip';
export { ProductCard, type ProductGroup } from './catalog/ProductCard';

// Hero
export { HomeHero } from './hero/HomeHero';
export { CategoryHero } from './hero/CategoryHero';
export { LandingHero } from './hero/LandingHero';

// States
export { EmptyState } from './states/EmptyState';
export { ErrorState } from './states/ErrorState';
export { LoadingState } from './states/LoadingState';
export { StatefulList } from './states/StatefulList';

// Motion
export { Reveal } from './motion/Reveal';
export { StaggerChildren } from './motion/StaggerChildren';
export { useMotionPrefs } from './motion/useMotionPrefs';

// Reviews
export { default as ReviewStars } from './reviews/ReviewStars';
export { default as ReviewCard } from './reviews/ReviewCard';
export { default as ReviewsSection } from './reviews/ReviewsSection';
export { default as CreateReviewForm } from './reviews/CreateReviewForm';
