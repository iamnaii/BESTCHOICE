import { Extension } from '@tiptap/core';

export interface IndentOptions {
  types: string[];
  minLevel: number;
  maxLevel: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
      toggleFirstLineIndent: () => ReturnType;
    };
  }
}

const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
      minLevel: 0,
      maxLevel: 8,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const ml = element.style.marginLeft;
              if (!ml) return 0;
              return Math.round(parseFloat(ml) / 2) || 0;
            },
            renderHTML: (attributes) => {
              if (!attributes.indent || attributes.indent <= 0) return {};
              return { style: `margin-left: ${attributes.indent * 2}em` };
            },
          },
          firstLineIndent: {
            default: false,
            parseHTML: (element) => {
              const ti = element.style.textIndent;
              return !!ti && parseFloat(ti) > 0;
            },
            renderHTML: (attributes) => {
              if (!attributes.firstLineIndent) return {};
              return { style: 'text-indent: 2em' };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          let applied = false;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              const currentLevel = node.attrs.indent || 0;
              if (currentLevel < this.options.maxLevel) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: currentLevel + 1,
                  });
                }
                applied = true;
              }
            }
          });

          return applied;
        },

      outdent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          let applied = false;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              const currentLevel = node.attrs.indent || 0;
              if (currentLevel > this.options.minLevel) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: currentLevel - 1,
                  });
                }
                applied = true;
              }
            }
          });

          return applied;
        },

      toggleFirstLineIndent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          const { from, to } = selection;
          let applied = false;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              if (dispatch) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  firstLineIndent: !node.attrs.firstLineIndent,
                });
              }
              applied = true;
            }
          });

          return applied;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      'Shift-Tab': () => this.editor.commands.outdent(),
    };
  },
});

export default Indent;
