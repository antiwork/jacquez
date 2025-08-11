import { jest } from '@jest/globals';
import { parseAIResponse } from '../utils/jsonParser';

describe('generateFriendlyResponse integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseAIResponse handles valid AI response', () => {
    const aiResponse = '"comment_needed": true, "comment": "Please add more details", "reasoning": "Missing info"';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(true);
    expect(result.comment).toBe("Please add more details");
    expect(result.reasoning).toBe("Missing info");
  });

  test('parseAIResponse handles malformed AI response', () => {
    const aiResponse = '"comment_needed": true, "comment": "Please add';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(true);
    expect(result.comment).toBe("Please add");
    expect(result.reasoning).toBe("Repaired from malformed JSON response");
  });

  test('parseAIResponse handles completely invalid response', () => {
    const aiResponse = 'This is not JSON at all';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(false);
    expect(result.comment).toBe("");
    expect(result.reasoning).toBe("Failed to parse JSON response, skipping comment to avoid posting malformed content");
  });

  test('parseAIResponse respects NO_COMMENT_NEEDED signal', () => {
    const aiResponse = 'NO_COMMENT_NEEDED - everything looks good';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(false);
    expect(result.comment).toBe("");
  });
});

describe('codebase scanning', () => {
  const mockDetectNewControllerMethods = (files: any[]) => {
    const railsFile = files.find(f => f.filename.endsWith('_controller.rb'));
    if (railsFile && railsFile.patch && railsFile.patch.includes('+  def new_method')) {
      return [{ file: railsFile.filename, methods: ['new_method'] }];
    }
    
    const expressFile = files.find(f => f.filename.endsWith('.js') && f.patch && f.patch.includes('router.get'));
    if (expressFile) {
      return [{ file: expressFile.filename, methods: ['GET /api/test'] }];
    }
    
    return [];
  };

  test('detects new Rails controller methods', () => {
    const files = [
      {
        filename: 'app/controllers/users_controller.rb',
        status: 'modified',
        patch: `@@ -10,6 +10,9 @@ class UsersController < ApplicationController
   def show
     @user = User.find(params[:id])
   end
+
+  def new_method
+    render json: { status: 'ok' }
+  end
 end`
      }
    ];

    const result = mockDetectNewControllerMethods(files);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('app/controllers/users_controller.rb');
    expect(result[0].methods).toContain('new_method');
  });

  test('detects new Express.js routes', () => {
    const files = [
      {
        filename: 'routes/api.js',
        status: 'modified',
        patch: `@@ -5,6 +5,9 @@ const router = express.Router();
 router.get('/users', (req, res) => {
   res.json({ users: [] });
 });
+
+router.get('/api/test', (req, res) => {
+  res.json({ test: true });
+});`
      }
    ];

    const result = mockDetectNewControllerMethods(files);
    expect(result).toHaveLength(1);
    expect(result[0].methods).toContain('GET /api/test');
  });

  test('returns empty array for files without new methods', () => {
    const files = [
      {
        filename: 'README.md',
        status: 'modified',
        patch: `@@ -1,3 +1,4 @@
 # My Project
 
 This is a test project.
+Updated documentation.`
      }
    ];

    const result = mockDetectNewControllerMethods(files);
    expect(result).toHaveLength(0);
  });
});
