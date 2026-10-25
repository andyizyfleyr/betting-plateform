export default function Loading() {
  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-4">
      <div className="flex items-center justify-between">
        <div className="shimmer h-7 w-36 rounded-lg" />
        <div className="shimmer h-7 w-20 rounded-full" />
      </div>
      <div className="flex gap-2">
        <div className="shimmer h-9 w-20 rounded-full" />
        <div className="shimmer h-9 w-20 rounded-full" />
        <div className="shimmer h-9 w-20 rounded-full" />
      </div>
      <div className="mt-1 flex flex-col gap-3">
        <div className="shimmer h-[156px] rounded-2xl" />
        <div className="shimmer h-[156px] rounded-2xl" />
        <div className="shimmer h-[156px] rounded-2xl" />
      </div>
    </div>
  );
}
