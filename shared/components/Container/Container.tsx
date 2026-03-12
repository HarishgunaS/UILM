import React from 'react';
import './Container.css';

export interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  fullHeight?: boolean;
}

export function Container({ 
  children, 
  className = '', 
  maxWidth = '1200px',
  fullHeight = false 
}: ContainerProps) {
  return (
    <div
      className={`shared-container ${fullHeight ? 'shared-container-full-height' : ''} ${className}`}
      style={{ '--max-width': maxWidth } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

export default Container;
