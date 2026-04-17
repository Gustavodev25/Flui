import { Sidebar } from '../Sidebar'
import { Topbar } from '../Topbar'
import { useSidebar } from '../../contexts/SidebarContext'
import { motion, AnimatePresence } from 'framer-motion'
import { Outlet, useLocation } from 'react-router-dom'
import { FinlozBottomLogo } from '../FinlozBottomLogo'
import { FeedbackWidget } from '../FeedbackWidget'

export const AppLayout: React.FC = () => {
  const { isCollapsed, isMobileOpen, closeMobileMenu } = useSidebar()
  const location = useLocation()
  
  const isCalendarPage = location.pathname === '/calendar'

  return (
    <div className={`min-h-screen bg-[#f7f7f5] text-[#37352f] flex font-sans selection:bg-[#2383e2]/20 lg:overflow-hidden relative`}>
      {/* Overlay para Mobile */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeMobileMenu}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[45] lg:hidden"
          />
        )}
      </AnimatePresence>

      <Sidebar />
      
      {/* Área Principal Estável (Não remonta na troca de rota) */}
      <main 
        className={`flex-1 flex flex-col min-h-screen lg:h-screen relative bg-[#f7f7f5] transition-all duration-500 ease-in-out ${isCollapsed ? 'lg:ml-[70px]' : 'lg:ml-[240px]'} ml-0`}
      >
        <Topbar />
        
        {/* Área de Conteúdo arredondada com borda nativa */}
        <div className="flex-1 bg-white rounded-none lg:rounded-tl-[32px] border-[#e9e9e7] lg:border-l lg:border-t relative flex flex-col min-w-0 shadow-sm lg:overflow-hidden overflow-x-hidden">
          <div className="flex-1 flex flex-col lg:overflow-hidden overflow-x-hidden">
            <Outlet />
          </div>
        </div>
        <FinlozBottomLogo />
      </main>
      {/* Feedback flutuante: escondido no mobile, aparece dentro do Topbar */}
      <div className="hidden lg:block">
        {!isCalendarPage && <FeedbackWidget />}
      </div>
    </div>
  )
}
