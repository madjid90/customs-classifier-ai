import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Shield, UserPlus, Loader2, RefreshCw, Trash2, Send, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { UserRole } from "@/lib/types";

interface UserWithRole {
  user_id: string;
  phone: string;
  role: UserRole | null;
  company_name: string;
  created_at: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrateur",
  manager: "Manager",
  agent: "Agent",
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-destructive/10 text-destructive border-destructive/20",
  manager: "bg-primary/10 text-primary border-primary/20",
  agent: "bg-muted text-muted-foreground border-muted-foreground/20",
};

export function UserManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  
  // New user form
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("agent");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setIsLoading(true);
    try {
      // Get all profiles with their roles and company info
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select(`
          user_id,
          phone,
          created_at,
          companies:company_id(name)
        `)
        .order("created_at", { ascending: false });

      if (profilesError) throw profilesError;

      // Get roles separately
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role");

      if (rolesError) throw rolesError;

      const rolesMap = new Map(roles?.map((r) => [r.user_id, r.role as UserRole]));

      const usersWithRoles: UserWithRole[] = (profiles || []).map((p) => ({
        user_id: p.user_id,
        phone: p.phone,
        role: rolesMap.get(p.user_id) || null,
        company_name: (p.companies as { name: string } | null)?.name || "N/A",
        created_at: p.created_at,
      }));

      setUsers(usersWithRoles);
    } catch (err) {
      console.error("Failed to fetch users:", err);
      toast({
        title: "Erreur",
        description: "Impossible de charger les utilisateurs",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: UserRole | "none") {
    setIsUpdating(userId);
    try {
      if (newRole === "none") {
        // Remove role
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        // Upsert role
        const { error } = await supabase
          .from("user_roles")
          .upsert({ user_id: userId, role: newRole }, { onConflict: "user_id" });
        if (error) throw error;
      }

      toast({
        title: "Rôle mis à jour",
        description: newRole === "none" ? "Rôle supprimé" : `Rôle défini sur ${ROLE_LABELS[newRole]}`,
      });

      fetchUsers();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de la mise à jour",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(null);
    }
  }

  async function handleDeleteUser(userId: string) {
    try {
      // Delete role first (if exists)
      await supabase.from("user_roles").delete().eq("user_id", userId);
      
      // Delete profile
      const { error } = await supabase.from("profiles").delete().eq("user_id", userId);
      if (error) throw error;

      toast({
        title: "Utilisateur supprimé",
      });

      fetchUsers();
    } catch (err) {
      toast({
        title: "Erreur",
        description: err instanceof Error ? err.message : "Erreur lors de la suppression",
        variant: "destructive",
      });
    } finally {
      setDeleteConfirm(null);
    }
  }

  async function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newPhone) return;

    // Validate phone format
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    const cleanPhone = newPhone.replace(/[\s\-\(\)]/g, "");
    if (!phoneRegex.test(cleanPhone)) {
      toast({
        title: "Format invalide",
        description: "Utilisez le format international: +33... ou +212...",
        variant: "destructive",
      });
      return;
    }

    setIsInviting(true);
    setInviteSuccess(false);
    
    try {
      const { data, error } = await supabase.functions.invoke("send-invite", {
        body: {
          phone: cleanPhone,
          role: newRole,
        },
      });

      if (error) throw error;

      if (data.already_exists) {
        toast({
          title: "Rôle mis à jour",
          description: `L'utilisateur existe déjà. Son rôle a été mis à jour en ${ROLE_LABELS[newRole]}.`,
        });
      } else {
        toast({
          title: "Invitation envoyée",
          description: `SMS d'invitation envoyé à ${newPhone}`,
        });
      }

      setInviteSuccess(true);
      setNewPhone("");
      
      // Refresh users list
      fetchUsers();
      
      // Reset success state after 3s
      setTimeout(() => setInviteSuccess(false), 3000);
    } catch (err) {
      console.error("Invite error:", err);
      toast({
        title: "Erreur d'envoi",
        description: err instanceof Error ? err.message : "Impossible d'envoyer l'invitation",
        variant: "destructive",
      });
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{users.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Admins</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">
              {users.filter((u) => u.role === "admin").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Managers</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">
              {users.filter((u) => u.role === "manager").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-muted-foreground">
              {users.filter((u) => u.role === "agent").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Gestion des utilisateurs
            </CardTitle>
            <CardDescription>Gérez les rôles et permissions</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>Entreprise</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Inscription</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.user_id}>
                    <TableCell className="font-mono">{user.phone}</TableCell>
                    <TableCell>{user.company_name}</TableCell>
                    <TableCell>
                      {user.role ? (
                        <Badge variant="outline" className={ROLE_COLORS[user.role]}>
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Aucun rôle
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(user.created_at).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Select
                          value={user.role || "none"}
                          onValueChange={(v) => handleRoleChange(user.user_id, v as UserRole | "none")}
                          disabled={isUpdating === user.user_id}
                        >
                          <SelectTrigger className="w-32 h-8">
                            {isUpdating === user.user_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Aucun</SelectItem>
                            <SelectItem value="agent">Agent</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirm(user.user_id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Aucun utilisateur trouvé
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add User Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Inviter un utilisateur
          </CardTitle>
          <CardDescription>
            L'utilisateur recevra un SMS pour créer son compte
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInviteUser} className="flex gap-4 items-center">
            <Input
              placeholder="+33 ou +212..."
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="max-w-xs"
            />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={isInviting || !newPhone}>
              {isInviting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : inviteSuccess ? (
                <CheckCircle className="mr-2 h-4 w-4 text-success" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {inviteSuccess ? "Envoyé !" : "Envoyer invitation"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet utilisateur ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. L'utilisateur perdra l'accès à l'application.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDeleteUser(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
