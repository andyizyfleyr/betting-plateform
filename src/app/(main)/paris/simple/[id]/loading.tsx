export default function SingleBetLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2.5 px-3 pb-6 pt-2.5 lg:space-y-4 lg:px-0 lg:py-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="shimmer h-8 w-8 rounded-full lg:h-9 lg:w-9" />
          <div className="shimmer h-5 w-28 rounded-lg lg:h-6 lg:w-32" />
        </div>
        <div className="shimmer h-7 w-20 rounded-full" />
      </div>
      <div className="shimmer h-36 rounded-xl lg:h-40 lg:rounded-2xl" />
      <div className="shimmer h-32 rounded-xl lg:h-36 lg:rounded-2xl" />
    </div>
  );
}
