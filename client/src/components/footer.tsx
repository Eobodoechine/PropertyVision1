export default function Footer() {
  return (
    <footer className="bg-white/70 backdrop-blur border-t border-gray-200 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-center text-sm text-gray-500" data-testid="footer-text">
          © {new Date().getFullYear()} PropertyVision
        </p>
      </div>
    </footer>
  );
}
