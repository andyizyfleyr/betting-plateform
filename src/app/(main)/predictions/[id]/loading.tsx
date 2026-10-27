export default function PredictionDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pb-6 pt-3 lg:px-0 lg:py-0">
      <div className="flex items-center gap-2">
        <div className="shimmer h-9 w-9 rounded-full" />
        <div className="shimmer h-5 w-36 rounded-lg" />
      </div>
      <div className="shimmer h-40 rounded-2xl" />
      <div className="shimmer h-32 rounded-2xl" />
    </div>
  );
}
