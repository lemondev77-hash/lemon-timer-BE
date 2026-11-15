import { Controller, Post, Get, Patch, Body, Param, Headers } from '@nestjs/common';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: { username: string; password: string }) {
    return this.authService.register(body.username, body.password);
  }

  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Get('me')
  getMe(@Headers('authorization') authHeader?: string) {
    return this.authService.getMe(authHeader);
  }

  @Get('profile/:userId')
  getProfile(@Param('userId') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('profile/:userId/avatar')
  updateAvatar(
    @Param('userId') userId: string,
    @Body() body: { avatar: string },
  ) {
    return this.authService.updateAvatar(userId, body.avatar);
  }
}