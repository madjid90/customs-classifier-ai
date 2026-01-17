-- Allow service role to insert into companies (for OTP signup flow)
CREATE POLICY "Service role can insert companies"
ON public.companies
FOR INSERT
TO service_role
WITH CHECK (true);

-- Allow service role to insert profiles (for OTP signup flow)  
CREATE POLICY "Service role can insert profiles"
ON public.profiles
FOR INSERT
TO service_role
WITH CHECK (true);

-- Allow service role to insert user roles (for OTP signup flow)
CREATE POLICY "Service role can insert user roles"
ON public.user_roles
FOR INSERT
TO service_role
WITH CHECK (true);