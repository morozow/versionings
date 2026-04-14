const React = require('react');

/**
 * Card component with a title, content area, and optional footer.
 *
 * @param {Object} props
 * @param {string} [props.title]
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 */
function Card({ title, children, footer }) {
  return React.createElement('div', { className: 'card' },
    title
      ? React.createElement('div', { className: 'card-header' },
        React.createElement('h3', { className: 'card-title' }, title)
      )
      : null,
    React.createElement('div', { className: 'card-body' }, children),
    footer
      ? React.createElement('div', { className: 'card-footer' }, footer)
      : null
  );
}

module.exports = { Card };
