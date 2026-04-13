import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'

interface SidebarContextType {
  isCollapsed: boolean
  isMobileOpen: boolean
  toggleCollapse: () => void
  toggleMobileMenu: () => void
  closeMobileMenu: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

const STORAGE_KEY = 'flui_sidebar_collapsed'

export const SidebarProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : false
  })
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(isCollapsed))
  }, [isCollapsed])

  const toggleCollapse = useCallback(() => setIsCollapsed((prev: boolean) => !prev), [])
  const toggleMobileMenu = useCallback(() => setIsMobileOpen((prev: boolean) => !prev), [])
  const closeMobileMenu = useCallback(() => setIsMobileOpen(false), [])

  return (
    <SidebarContext.Provider value={{ 
      isCollapsed, 
      isMobileOpen, 
      toggleCollapse, 
      toggleMobileMenu,
      closeMobileMenu 
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
