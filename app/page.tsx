import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-6 py-12">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            GitHub Contributing Guidelines Bot
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            An AI-powered GitHub App that automatically validates submissions against repository 
            contributing guidelines and provides friendly, specific feedback to contributors.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 mb-12">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-blue-600 mb-4">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Smart Validation</h3>
              <p className="text-gray-600">
                Uses Claude AI to analyze pull requests, issues, and comments against your project's 
                contributing guidelines with contextual understanding.
              </p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-green-600 mb-4">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-1l-4 4z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Friendly Feedback</h3>
              <p className="text-gray-600">
                Provides specific, actionable feedback about missing requirements while 
                maintaining an encouraging and welcoming tone.
              </p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-purple-600 mb-4">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">High Performance</h3>
              <p className="text-gray-600">
                Features intelligent caching, configurable settings, and comprehensive 
                logging for optimal performance and debugging.
              </p>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="text-orange-600 mb-4">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Easy Setup</h3>
              <p className="text-gray-600">
                Simple deployment to Vercel with environment variables. 
                Automatically finds contributing guidelines in multiple locations.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">How It Works</h2>
            <div className="space-y-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-semibold">
                    1
                  </div>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-semibold text-gray-900">Webhook Event</h4>
                  <p className="text-gray-600">GitHub sends webhook events for new issues, pull requests, or comments</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-semibold">
                    2
                  </div>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-semibold text-gray-900">Load Guidelines</h4>
                  <p className="text-gray-600">Bot automatically loads CONTRIBUTING.md from the repository</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-semibold">
                    3
                  </div>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-semibold text-gray-900">AI Analysis</h4>
                  <p className="text-gray-600">Claude AI analyzes the submission against the guidelines</p>
                </div>
              </div>
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-semibold">
                    4
                  </div>
                </div>
                <div className="ml-4">
                  <h4 className="text-lg font-semibold text-gray-900">Friendly Response</h4>
                  <p className="text-gray-600">Posts a helpful comment with specific feedback or encouragement</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg shadow-lg p-8 text-white">
            <h2 className="text-2xl font-bold mb-4">Quick Setup</h2>
            <div className="space-y-4">
              <div>
                <h4 className="text-lg font-semibold mb-2">1. Deploy to Vercel</h4>
                <div className="bg-gray-800 rounded p-3 font-mono text-sm">
                  vercel --prod
                </div>
              </div>
              <div>
                <h4 className="text-lg font-semibold mb-2">2. Set Environment Variables</h4>
                <div className="bg-gray-800 rounded p-3 font-mono text-sm">
                  APP_ID=your_github_app_id<br/>
                  WEBHOOK_SECRET=your_webhook_secret<br/>
                  PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."<br/>
                  ANTHROPIC_API_KEY=your_anthropic_key
                </div>
              </div>
              <div>
                <h4 className="text-lg font-semibold mb-2">3. Configure Webhook URL</h4>
                <div className="bg-gray-800 rounded p-3 font-mono text-sm">
                  https://your-app.vercel.app/api/webhook
                </div>
              </div>
            </div>
          </div>

          <div className="text-center mt-12">
            <Link
              href="https://github.com/antiwork/jacquez"
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
              </svg>
              View on GitHub
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}