import React, {
  Attributes,
  FunctionComponent,
  ReactElement,
  ReactNode,
  RefObject,
  useEffect, useRef, forwardRef,
} from 'react';
// @ts-ignore
import { setupAppear } from 'appear-polyfill';
import { cached } from 'style-unit';
import { isFunction, isObject, isNumber } from './type';

let appearSetup = false;
function setupAppearOnce() {
  if (!appearSetup) {
    setupAppear();
    appearSetup = true;
  }
}

const hasOwn = {}.hasOwnProperty;

// https://github.com/alibaba/rax/blob/master/packages/driver-dom/src/index.js
// opacity -> opa
// fontWeight -> ntw
// lineHeight|lineClamp -> ne[ch]
// flex|flexGrow|flexPositive|flexShrink|flexNegative|boxFlex|boxFlexGroup|zIndex -> ex(?:s|g|n|p|$)
// order -> ^ord
// zoom -> zoo
// gridArea|gridRow|gridRowEnd|gridRowSpan|gridRowStart|gridColumn|gridColumnEnd|gridColumnSpan|gridColumnStart -> grid
// columnCount -> mnc
// tabSize -> bs
// orphans -> orp
// windows -> ows
// animationIterationCount -> onit
// borderImageOutset|borderImageSlice|borderImageWidth -> erim
const NON_DIMENSIONAL_REG = /opa|ntw|ne[ch]|ex(?:s|g|n|p|$)|^ord|zoo|grid|orp|ows|mnc|^columns$|bs|erim|onit/i;


/**
 * Compat createElement for rax export.
 * Reference: https://github.com/alibaba/rax/blob/master/packages/rax/src/createElement.js#L13
 * @param type
 * @param props
 * @param children
 * @returns Element
 */
export function createElement<P extends {
  ref: RefObject<any>;
  children: any;
  style?: object;
  onAppear?: Function;
  onDisappear?: Function;
}>(
  type: FunctionComponent<P>,
  props?: Attributes & P | null,
  ...children: ReactNode[]): ReactElement {
  const { children: propsChildren, onAppear, onDisappear, ...rest } = props;
  // Compat for style unit.
  rest.style = compatStyle(rest.style);

  rest.ref = props.ref || useRef(null);
  let element: any = React.createElement(type, rest as Attributes & P | null, propsChildren, ...children);
  // Polyfill onAppear and onDisappear.
  if (isFunction(onAppear) || isFunction(onDisappear)) {
    setupAppearOnce();
    element = React.createElement(forwardRef(AppearOrDisappear), {
      onAppear: onAppear,
      onDisappear: onDisappear,
      ref: rest.ref,
    }, element);
  }

  return element;
}

const isDimensionalProp = cached((prop: string) => !NON_DIMENSIONAL_REG.test(prop));

// Convert numeric value into rpx.
// eg. width: 2px ->
function compatStyle(style?: object): any {
  if (isObject(style)) {
    const result = {};
    for (let key in style) {
      if (hasOwn.call(style, key)) {
        // @ts-ignore
        if (isNumber(style[key]) && isDimensionalProp(key)) result[key] = `${style[key]}rpx`;
      }
    }
    return result;
  }
}

// Appear HOC Component.
function AppearOrDisappear(props: any, ref: RefObject<EventTarget>) {
  const { onAppear, onDisappear } = props;

  listen('appear', onAppear);
  listen('disappear', onDisappear);

  function listen(eventName: string, handler: EventListenerOrEventListenerObject) {
    if (isFunction(handler) && ref != null) {
      useEffect(() => {
        const { current } = ref;
        if (current != null) {
          current.addEventListener(eventName, handler);
        }
        return () => {
          const { current } = ref;
          if (current) {
            current.removeEventListener(eventName, handler);
          }
        };
      }, [ref, handler]);
    }
  }

  return props.children;
}
