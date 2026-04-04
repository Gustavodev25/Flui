import React from 'react'

interface ConcaveCornerProps {
  className?: string
  color?: string
  size?: number
}

export const ConcaveCorner: React.FC<ConcaveCornerProps> = ({ 
  className = "", 
  color = "#f7f7f5", 
  size = 24
}) => {
  return (
    <div 
      className={`absolute z-[60] pointer-events-none ${className}`}
      style={{ 
        width: size, 
        height: size, 
        background: `radial-gradient(circle at 100% 100%, transparent ${size}px, ${color} ${size}px)`
      }}
    />
  )
}
