import { Zap } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 px-3 pb-24 pt-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="shimmer h-3 w-24 rounded-md" />
          <div className="shimmer mt-2 h-8 w-32 rounded-lg" />
        </div>
        <div className="shimmer h-10 w-24 rounded-xl" />
      </div>

      <div className="shimmer mt-2 h-11 w-full rounded-xl" />

      <div className="mt-2 flex flex-col gap-2.5">
        <div className="shimmer h-[220px] rounded-[20px]" />
        <div className="shimmer h-[144px] rounded-[18px]" />
        <div className="shimmer h-[144px] rounded-[18px]" />
      </div>

      <div className="mt-auto flex justify-center">
        <div className="flex items-center gap-2 text-dim">
          <span className="grid h-5 w-5 rotate-45 place-items-center rounded-[5px] bg-betclic-red/20">
            <Zap className="h-2.5 w-2.5 -rotate-45 text-betclic-red/40" strokeWidth={2.4} />
          </span>
          <span className="text-[10px] font-semibold tracking-[0.28em] uppercase">Chargement</span>
        </div>
      </div>
    </div>
  );
}