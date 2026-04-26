import { motion } from "framer-motion";

interface InfiniteRibbonProps {
  children: React.ReactNode;
  className?: string;
  reverse?: boolean;
  rotation?: number;
  speed?: number;
  backgroundColor?: string;
  textColor?: string;
}

export function InfiniteRibbon({
  children,
  className,
  reverse = false,
  rotation = 0,
  speed = 40,
  backgroundColor = "bg-white/80",
  textColor = "text-[#37352f]/40",
}: InfiniteRibbonProps) {
  const combinedClassName = `${backgroundColor} ${textColor} ${className || ""} overflow-hidden whitespace-nowrap py-1 select-none backdrop-blur-[2px]`;
  return (
    <div
      className={combinedClassName}
      style={{
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <div className="flex">
        <motion.div
          animate={{ x: reverse ? ["-100%", "0%"] : ["0%", "-100%"] }}
          transition={{
            duration: speed,
            repeat: Infinity,
            ease: "linear",
          }}
          className="flex flex-shrink-0 items-center gap-12 min-w-full"
        >
          {Array.from({ length: 30 }).map((_, i) => (
            <span key={i} className="text-[9px] font-bold uppercase tracking-[0.2em] flex-shrink-0">{children}</span>
          ))}
        </motion.div>
        <motion.div
          animate={{ x: reverse ? ["-100%", "0%"] : ["0%", "-100%"] }}
          transition={{
            duration: speed,
            repeat: Infinity,
            ease: "linear",
          }}
          className="flex flex-shrink-0 items-center gap-12 min-w-full"
        >
          {Array.from({ length: 30 }).map((_, i) => (
            <span key={i} className="text-[9px] font-bold uppercase tracking-[0.2em] flex-shrink-0">{children}</span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
