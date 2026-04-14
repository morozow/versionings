const React = require('react');
const { classnames } = require('../utils/classnames');

/**
 * Button component with variant and size support.
 *
 * @param {Object} props
 * @param {'primary'|'secondary'|'danger'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.disabled=false]
 * @param {Function} [props.onClick]
 * @param {React.ReactNode} props.children
 */
function Button({ variant = 'primary', size = 'md', disabled = false, onClick, children }) {
  const className = classnames('btn', `btn-${variant}`, `btn-${size}`, {
    'btn-disabled': disabled,
  });

  return React.createElement(
    'button',
    {
      className,
      disabled,
      onClick: disabled ? undefined : onClick,
      type: 'button',
    },
    children
  );
}

module.exports = { Button };
