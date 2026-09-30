import type { ReactNode } from 'react';
import { useMoreDetail } from './useDetail';

/** Detail on its own: shown to those who see everything, one tap away for the rest. */
export default function MoreDetail({ children }: { children: ReactNode }) {
  const { full, toggle } = useMoreDetail();
  return (
    <>
      {full && children}
      {toggle}
    </>
  );
}
