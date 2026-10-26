import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon, type LucideProps } from 'lucide-react';

const icons = { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon };
// ReUI's registry resolves these placeholders when installing a selected icon set.
export function IconPlaceholder({ lucide, tabler: _t, hugeicons: _h, phosphor: _p, remixicon: _r, ...props }: LucideProps & {
  lucide: keyof typeof icons; tabler?: string; hugeicons?: string; phosphor?: string; remixicon?: string;
}) {
  const Icon = icons[lucide];
  return <Icon aria-hidden="true" {...props} />;
}
