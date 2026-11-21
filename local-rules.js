const EM_DASH = String.fromCodePoint(0x20_14)
const WORKAROUND =
  /^\s*(?:(?:oxlint|eslint)-(?:disable(?:-next-line|-line)?|enable)\s\S.*?\s--\s|@ts-expect-error\s)?WORKAROUND\(https?:\/\/[^\s)]+\): \S[^\n]*$/

const noComments = {
  meta: {
    type: 'problem',
    messages: {
      comment:
        'Make the code say it instead: names, types, smaller expressions. A comment is kept only for a workaround forced by an outside defect, written as `WORKAROUND(<issue url>): <what it disables and when it can go>`.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const kept = comment.type === 'Shebang' || comment.value.startsWith('/ <reference ')
          if (!kept && !WORKAROUND.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'comment' })
          }
        }
      },
    }
  },
}

const noEmDash = {
  meta: {
    type: 'problem',
    messages: { emDash: 'Use a comma, colon or period instead of an em dash (U+2014).' },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'emDash' })

    return {
      Literal(node) {
        if (typeof node.value === 'string' && node.value.includes(EM_DASH)) {
          report(node)
        }
      },
      TemplateElement(node) {
        if (node.value.raw.includes(EM_DASH)) {
          report(node)
        }
      },
      JSXText(node) {
        if (node.value.includes(EM_DASH)) {
          report(node)
        }
      },
    }
  },
}

export default {
  meta: { name: 'local' },
  rules: { 'no-comments': noComments, 'no-em-dash': noEmDash },
}
