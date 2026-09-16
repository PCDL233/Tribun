import type { CSSProperties, ReactElement } from 'react';
import type { User } from '@ai-review/shared/api';
import { initials } from './Brand';

type UserAvatarProps = {
  user: User | null | undefined;
  /** 追加到根元素的类名（控制尺寸/圆角，如 app-user-avatar / sidebar-user-avatar） */
  className?: string;
  style?: CSSProperties;
  alt?: string;
};

/**
 * 用户头像：已上传头像时渲染 <img>，否则回退到首字母占位。
 * 供侧栏、顶栏下拉、个人设置、后台用户列表等所有展示头像的位置统一使用。
 */
export function UserAvatar({ user, className, style, alt }: UserAvatarProps): ReactElement {
  if (user?.avatarUrl) {
    return (
      <img
        className={className}
        style={{ objectFit: 'cover', ...style }}
        src={user.avatarUrl}
        alt={alt ?? user.username}
        loading="lazy"
      />
    );
  }
  return (
    <span className={className} style={style}>
      {initials(user?.username)}
    </span>
  );
}
