/**
 * JSPredictor - Predictively closes JavaScript tokens (braces, brackets, parens) as code streams in
 * 
 * This class tracks opening tokens and predictively inserts closing tokens
 * so that partial JavaScript code can be written to files and remain syntactically valid.
 * When the complete content arrives, it reconciles predicted tokens with actual tokens.
 */
export class JSPredictor {
  private braceDepth: number = 0;      // {}
  private bracketDepth: number = 0;    // []
  private parenDepth: number = 0;      // ()
  private buffer: string = '';
  private inString: boolean = false;
  private stringDelimiter: string = '';
  private inTemplateLiteral: boolean = false;
  private templateExpressionDepth: number = 0; // Track ${} depth in template literals
  private inComment: boolean = false;
  private commentType: 'line' | 'block' | null = null;
  private pendingToken: string = '';
  private lastChar: string = '';
  
  // Track token stack for better prediction (know which tokens to close)
  private tokenStack: Array<'brace' | 'bracket' | 'paren'> = [];

  /**
   * Process a chunk of JavaScript content and return predicted content with closed tokens
   * Note: This accumulates chunks, so call reset() when starting a new tool call
   */
  processChunk(chunk: string): { predicted: string; pending: string } {
    // Append new chunk to buffer
    this.buffer += chunk;
    
    let i = 0;
    while (i < this.buffer.length) {
      const char = this.buffer[i];
      const prevChar = i > 0 ? this.buffer[i - 1] : '';
      const nextChar = i < this.buffer.length - 1 ? this.buffer[i + 1] : '';
      
      // Handle comments first (they can contain anything)
      if (this.inComment) {
        if (this.commentType === 'line') {
          // Line comment - ends at newline
          const newlineIndex = this.buffer.indexOf('\n', i);
          if (newlineIndex !== -1) {
            this.inComment = false;
            this.commentType = null;
            i = newlineIndex + 1;
            continue;
          } else {
            // Comment continues beyond buffer
            break;
          }
        } else if (this.commentType === 'block') {
          // Block comment - ends at */
          const commentEnd = this.buffer.indexOf('*/', i);
          if (commentEnd !== -1) {
            this.inComment = false;
            this.commentType = null;
            i = commentEnd + 2;
            continue;
          } else {
            // Comment continues beyond buffer
            break;
          }
        }
      }
      
      // Handle strings (they can contain anything except unescaped delimiter)
      if (this.inString || this.inTemplateLiteral) {
        if (this.inTemplateLiteral) {
          // Template literal - handle ${} expressions
          if (char === '$' && nextChar === '{') {
            this.templateExpressionDepth++;
            i += 2;
            continue;
          }
          
          if (char === '}' && this.templateExpressionDepth > 0) {
            this.templateExpressionDepth--;
            i++;
            continue;
          }
          
          // Template literal ends at unescaped `
          if (char === '`' && prevChar !== '\\') {
            this.inTemplateLiteral = false;
            this.stringDelimiter = '';
            i++;
            continue;
          }
        } else {
          // Regular string - find end delimiter (respecting escape sequences)
          let foundEnd = false;
          for (let j = i; j < this.buffer.length; j++) {
            if (this.buffer[j] === '\\') {
              j++; // Skip escaped character
              continue;
            }
            if (this.buffer[j] === this.stringDelimiter) {
              this.inString = false;
              this.stringDelimiter = '';
              i = j + 1;
              foundEnd = true;
              break;
            }
          }
          if (foundEnd) {
            continue;
          } else {
            // String continues beyond buffer
            break;
          }
        }
        
        // If we're still in string/template literal, continue to next char
        i++;
        continue;
      }
      
      // Check for comment start (only if not in string)
      if (char === '/' && nextChar === '/') {
        this.inComment = true;
        this.commentType = 'line';
        i += 2;
        continue;
      }
      
      if (char === '/' && nextChar === '*') {
        this.inComment = true;
        this.commentType = 'block';
        i += 2;
        continue;
      }
      
      // Check for string/template literal start
      if (char === '"' || char === "'") {
        this.inString = true;
        this.stringDelimiter = char;
        i++;
        continue;
      }
      
      if (char === '`') {
        this.inTemplateLiteral = true;
        this.stringDelimiter = '`';
        i++;
        continue;
      }
      
      // Track token depth (only if not in string/comment)
      if (char === '{') {
        this.braceDepth++;
        this.tokenStack.push('brace');
        i++;
        continue;
      }
      
      if (char === '}') {
        if (this.braceDepth > 0) {
          this.braceDepth--;
          // Remove matching brace from stack
          const lastToken = this.tokenStack[this.tokenStack.length - 1];
          if (lastToken === 'brace') {
            this.tokenStack.pop();
          } else {
            // Mismatch - but still decrement depth
            // This handles cases where prediction was wrong
            const braceIndex = this.tokenStack.lastIndexOf('brace');
            if (braceIndex !== -1) {
              this.tokenStack.splice(braceIndex, 1);
            }
          }
        }
        i++;
        continue;
      }
      
      if (char === '[') {
        this.bracketDepth++;
        this.tokenStack.push('bracket');
        i++;
        continue;
      }
      
      if (char === ']') {
        if (this.bracketDepth > 0) {
          this.bracketDepth--;
          const lastToken = this.tokenStack[this.tokenStack.length - 1];
          if (lastToken === 'bracket') {
            this.tokenStack.pop();
          } else {
            const bracketIndex = this.tokenStack.lastIndexOf('bracket');
            if (bracketIndex !== -1) {
              this.tokenStack.splice(bracketIndex, 1);
            }
          }
        }
        i++;
        continue;
      }
      
      if (char === '(') {
        this.parenDepth++;
        this.tokenStack.push('paren');
        i++;
        continue;
      }
      
      if (char === ')') {
        if (this.parenDepth > 0) {
          this.parenDepth--;
          const lastToken = this.tokenStack[this.tokenStack.length - 1];
          if (lastToken === 'paren') {
            this.tokenStack.pop();
          } else {
            const parenIndex = this.tokenStack.lastIndexOf('paren');
            if (parenIndex !== -1) {
              this.tokenStack.splice(parenIndex, 1);
            }
          }
        }
        i++;
        continue;
      }
      
      i++;
    }
    
    // Generate predicted content with closing tokens
    let predicted = this.buffer;
    
    // Only add predicted tokens if we're not in the middle of a string/comment
    if (!this.inString && !this.inTemplateLiteral && !this.inComment) {
      // Generate closing tokens in reverse order of opening
      const closingTokens: string[] = [];
      
      // Close tokens based on stack (LIFO order)
      for (let j = this.tokenStack.length - 1; j >= 0; j--) {
        const token = this.tokenStack[j];
        if (token === 'brace') {
          closingTokens.push('}');
        } else if (token === 'bracket') {
          closingTokens.push(']');
        } else if (token === 'paren') {
          closingTokens.push(')');
        }
      }
      
      if (closingTokens.length > 0) {
        predicted = this.buffer + closingTokens.join('');
      }
    }
    
    // Store pending token if we're in the middle of something
    if (this.inString || this.inTemplateLiteral || this.inComment) {
      // Find where the pending content starts
      const pendingStart = Math.max(
        this.buffer.lastIndexOf('"'),
        this.buffer.lastIndexOf("'"),
        this.buffer.lastIndexOf('`'),
        this.buffer.lastIndexOf('//'),
        this.buffer.lastIndexOf('/*')
      );
      this.pendingToken = pendingStart !== -1 ? this.buffer.substring(pendingStart) : '';
    } else {
      this.pendingToken = '';
    }
    
    this.lastChar = this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : '';
    
    return { predicted, pending: this.pendingToken };
  }

  /**
   * Reconcile predicted content with actual complete content
   * Removes predicted closing tokens and ensures actual tokens match
   */
  reconcile(completeContent: string): string {
    // Reset state and process complete content to find actual structure
    this.reset();
    const result = this.processChunk(completeContent);
    
    // The complete content should have all tokens properly closed
    // If our prediction added extra closing tokens, they'll be at the end
    // We should use the actual content as-is since it's complete
    return completeContent;
  }

  /**
   * Reset the predictor state for a new tool call
   */
  reset(): void {
    this.braceDepth = 0;
    this.bracketDepth = 0;
    this.parenDepth = 0;
    this.buffer = '';
    this.inString = false;
    this.stringDelimiter = '';
    this.inTemplateLiteral = false;
    this.templateExpressionDepth = 0;
    this.inComment = false;
    this.commentType = null;
    this.pendingToken = '';
    this.lastChar = '';
    this.tokenStack = [];
  }

  /**
   * Check if content looks like JavaScript code that should use JS prediction
   */
  static isJSContent(content: string, filePath?: string): boolean {
    // Check file extension first
    if (filePath) {
      const ext = filePath.toLowerCase();
      if (ext.endsWith('.js') || ext.endsWith('.ts') || ext.endsWith('.jsx') || ext.endsWith('.tsx')) {
        // For JSX/TSX files, check if it's actually JS logic (not JSX)
        if (ext.endsWith('.jsx') || ext.endsWith('.tsx')) {
          // If it has JSX tags, it's JSX content, not pure JS
          const hasJSXTags = /<\s*[A-Za-z][A-Za-z0-9]*(\s+[^>]*)?>/.test(content);
          if (hasJSXTags) {
            return false; // This is JSX, not pure JS
          }
        }
        return true;
      }
    }
    
    // Check for JavaScript patterns
    const jsPatterns = [
      /\b(function|const|let|var|class|interface|type|enum)\s+/, // Declarations
      /\b(import|export)\s+/, // Module syntax
      /\b(if|for|while|switch|try|catch|async|await)\s*\(/, // Control flow
      /=>\s*\{/, // Arrow functions
      /:\s*\{/, // Object properties
      /\[\s*\]/, // Arrays
    ];
    
    const hasJSPatterns = jsPatterns.some(pattern => pattern.test(content));
    
    // Exclude if it's clearly HTML/XML (has tags but no JS patterns)
    const hasHTMLTags = /<\s*[a-z][a-z0-9]*(\s+[^>]*)?>/i.test(content);
    const isHTMLOnly = hasHTMLTags && !hasJSPatterns;
    
    // Exclude if it's clearly JSON
    const isJSON = /^\s*[\{\[]/.test(content.trim()) && 
                   !/\b(function|const|let|var|class|import|export)/.test(content);
    
    return hasJSPatterns && !isHTMLOnly && !isJSON;
  }

  /**
   * Check if the current buffer represents a complete statement
   * This is useful for deciding when to execute during streaming
   */
  isCompleteStatement(): boolean {
    // A statement is complete if:
    // 1. All tokens are closed (depth is 0)
    // 2. Not in the middle of a string/comment
    // 3. Ends with semicolon, or is a complete block (function/class/if/for/etc.)
    
    if (this.braceDepth > 0 || this.bracketDepth > 0 || this.parenDepth > 0) {
      return false; // Still have open tokens
    }
    
    if (this.inString || this.inTemplateLiteral || this.inComment) {
      return false; // In the middle of a string/comment
    }
    
    // Check if ends with semicolon (common statement terminator)
    const trimmed = this.buffer.trim();
    if (trimmed.endsWith(';')) {
      return true;
    }
    
    // Check if it's a complete block (ends with } and has proper structure)
    if (trimmed.endsWith('}')) {
      // Try to detect if this is a complete function/class/block
      // This is a heuristic - a complete block usually has balanced structure
      return true;
    }
    
    return false;
  }
}
