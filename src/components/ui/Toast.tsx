import { Toast as ArkToast, Toaster, createToaster } from "@ark-ui/react/toast";
import { X } from "lucide-react";
import "./Toast.css";

export const toaster = createToaster({
  placement: "bottom-end",
  gap: 16,
  overlap: true,
});

export function AppToaster() {
  return (
    <Toaster toaster={toaster}>
      {(toast) => (
        <ArkToast.Root 
          key={toast.id}
          className="ark-toast bg-white rounded-xl shadow-lg shadow-black/5 border border-[#e9e9e7] min-w-80 p-4 relative overflow-hidden"
        >
          <ArkToast.Title className="text-[#37352f] font-semibold text-sm">
            {toast.title}
          </ArkToast.Title>
          <ArkToast.Description className="text-[#37352f]/60 text-sm mt-1">
            {toast.description}
          </ArkToast.Description>
          <ArkToast.CloseTrigger className="absolute top-3 right-3 p-1 hover:bg-[#f1f1f0] rounded-md transition-colors text-[#37352f]/40 hover:text-[#37352f]">
            <X className="w-3.5 h-3.5" />
          </ArkToast.CloseTrigger>
        </ArkToast.Root>
      )}
    </Toaster>
  );
}
