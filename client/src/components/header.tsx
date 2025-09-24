export default function Header() {
  return (
    <header className="bg-white/70 backdrop-blur border-b border-gray-200/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-900" data-testid="app-title">
              PropertyVision
            </h1>
            <span className="ml-2 text-sm text-gray-500">ARV & Comps</span>
          </div>
          <nav className="flex space-x-4">
            <a 
              href="#" 
              className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium transition-colors duration-200"
              data-testid="link-help"
            >
              Help
            </a>
            <a 
              href="#" 
              className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm font-medium transition-colors duration-200"
              data-testid="link-api-status"
            >
              API Status
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
