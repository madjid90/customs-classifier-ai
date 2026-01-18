-- Enable realtime for classification_results and case_files tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.classification_results;
ALTER PUBLICATION supabase_realtime ADD TABLE public.case_files;