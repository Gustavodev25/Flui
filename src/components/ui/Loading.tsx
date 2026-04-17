import React from 'react'
import { motion } from 'framer-motion'

interface LoadingProps {
  fullScreen?: boolean
  message?: string
}

export const Loading: React.FC<LoadingProps> = ({ fullScreen = true, message }) => {
  const containerClasses = fullScreen
    ? 'fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#f7f7f5]'
    : 'w-full h-full flex flex-col items-center justify-center bg-transparent py-12'

  const iconVariants = {
    hidden: { opacity: 0, scale: 0.5, rotate: -45 },
    visible: { 
      opacity: 1, 
      scale: 1, 
      rotate: 0,
      transition: {
        duration: 0.8,
        ease: [0.76, 0, 0.24, 1]
      }
    }
  }

  const pathVariants = {
    hidden: { pathLength: 0, opacity: 0 },
    visible: { 
      pathLength: 1, 
      opacity: 1,
      transition: {
        duration: 1.5,
        ease: "easeInOut",
        repeat: Infinity,
        repeatType: "loop" as const,
        repeatDelay: 0.5
      }
    }
  }

  return (
    <div className={containerClasses}>
      <motion.div
        className="relative w-14 h-14"
        animate={{
          rotate: [0, 90, 180, 270, 360],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: [0.76, 0, 0.24, 1],
          times: [0, 0.2, 0.5, 0.8, 1],
        }}
      >
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full drop-shadow-sm"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Main Path */}
          <motion.path
            d="M127.33,60.05c7.62-2.5,21.93-14.64,29.12-15.05,4.23-.24,22.2,8.83,24.66,12.03,2.91,3.79,2.91,24.33,1.42,29.09-2.01,6.44-21,11.92-25.77,17.47.29,1.52,23.04,10.58,25.35,15.5,1.84,3.92,1.8,25.59-.34,29.35-1.25,2.2-21.16,13.76-23.98,14.46-8.88,2.21-22.09-10.31-30.47-13.35v20.72c0,6.1-19.99,17.5-24.91,17.77-4.69.26-26.74-11.35-26.74-16.57v-21.32c-8.12,2.08-19.96,13.7-27.95,13.25-3.3-.19-24.23-11.57-26.01-14.25-2.66-4.02-2.81-25.86-.81-30.05l25.34-16.09c-.46-1.33-21.5-10.35-24.29-14.16-3.55-4.85-3.64-28.32,1.26-32.91,1.77-1.66,18.67-10.65,20.91-10.92,8.3-1,23.23,11.69,31.55,14.43v-27.93c0-5.01,21.37-16.05,26.13-15.96,5.14.1,25.52,10.9,25.52,17.17v27.33ZM87.69,35.13v42.95l-41.3-20.92-14.56,7.99,51.08,30.08-.59,1.81-49.93,28.21c-.25,2.08,12.8,9.45,15.2,9.19l38.73-21.43,1.38.81v52.86l1.57,2.63c3.86.68,8.6,6.94,12.24,4.57v-64.87c0-.4,1.52-2.43,2.23-2.61l51.81,27.3,14.43-6.67v-3.01c-5.63-3.3-50.13-24.89-49.88-28.19.31-4.02,52.06-28.29,51.04-31.81-4.01-2.25-10.34-7.73-15-6.69-6.29,2.92-49.95,29.71-52.86,28.91-1.52-.42-1.55-1.11-1.82-2.43-.73-3.55-.54-33.34.18-37.13,2.01-10.57,26.75-8.37-.4-19.66l-13.56,8.09ZM31.83,73.87v10.21l22.86,13.79,8.24-5.69-31.1-18.31ZM121.32,123.13v10.51l31.23,17.72v-10.81l-31.23-17.42ZM53.45,151.36l21.62-12.31v-10.51c-2.3,1.98-21.62,11.39-21.62,12.91v9.91ZM31.83,135.14v10.51l10.81,5.71v-10.81l-10.81-5.41Z"
            fill="#232223"
            initial={{ opacity: 0.5, scale: 0.9 }}
            animate={{ 
              opacity: [0.5, 1, 0.5],
              scale: [0.9, 1, 0.9]
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />
          {/* Accents / Secondary Paths */}
          <motion.path
            d="M121.32 123.13 L152.56 140.55 L152.56 151.36 L121.32 133.64 L121.32 123.13"
            fill="#7b7b79"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.1 }}
          />
          <motion.path
            d="M31.83 73.87 L62.93 92.18 L54.69 97.87 L31.83 84.08 L31.83 73.87"
            fill="#7b7b79"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.3 }}
          />
          <motion.path
            d="M53.45,151.36v-9.91c0-1.53,19.32-10.94,21.62-12.91v10.51l-21.62,12.31Z"
            fill="#7b7b79"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.5 }}
          />
          <motion.path
            d="M31.83,135.14 L42.64,140.55 L42.64,151.36 L31.83,145.65 L31.83,135.14"
            fill="#7b7b79"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: 0.7 }}
          />
        </svg>
      </motion.div>
      
      {(message || fullScreen) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-6 flex flex-col items-center gap-1.5"
        >
          <span className="text-[10px] font-bold text-[#37352f]/40 uppercase tracking-[0.2em] text-center px-4">
            {message || "Flui Workspaces"}
          </span>
          <div className="flex items-center gap-1">
            <div className="w-1 h-1 rounded-full bg-[#37352f]/20 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1 h-1 rounded-full bg-[#37352f]/20 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1 h-1 rounded-full bg-[#37352f]/20 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </motion.div>
      )}
    </div>
  )
}
