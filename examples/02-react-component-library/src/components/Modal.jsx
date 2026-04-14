const React = require('react');
const { classnames } = require('../utils/classnames');

/**
 * Modal dialog with overlay and close handling.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {Function} props.onClose
 * @param {string} [props.title]
 * @param {React.ReactNode} props.children
 */
function Modal({ isOpen, onClose, title, children }) {
  React.useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleOverlayClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return React.createElement(
    'div',
    {
      className: 'modal-overlay',
      onClick: handleOverlayClick,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title || 'Modal',
    },
    React.createElement('div', { className: 'modal-dialog' },
      React.createElement('div', { className: 'modal-header' },
        title
          ? React.createElement('h2', { className: 'modal-title' }, title)
          : null,
        React.createElement(
          'button',
          {
            className: 'modal-close',
            onClick: onClose,
            type: 'button',
            'aria-label': 'Close',
          },
          '\u00D7'
        )
      ),
      React.createElement('div', { className: 'modal-body' }, children)
    )
  );
}

module.exports = { Modal };
