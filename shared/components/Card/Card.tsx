import React from 'react';
import './Card.css';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      className={`shared-card ${onClick ? 'shared-card-clickable' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export default Card;
